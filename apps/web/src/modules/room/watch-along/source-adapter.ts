import type {
  ClaimedSourceHandle,
  PreparedSourceHandle,
  ProgramStreamHandle,
  WatchSourceEvent,
} from '@tether/client-runtime/modules/watch-along';
import { Data, Effect, Exit, Scope } from 'effect';

export class WebWatchSourceError extends Data.TaggedError('WebWatchSourceError')<{
  readonly operation: 'prepare' | 'claim' | 'play' | 'pause' | 'seek' | 'observe' | 'prime';
  readonly cause: unknown;
}> {}

export interface CapturableVideoElement extends HTMLVideoElement {
  readonly captureStream: () => MediaStream;
}

export interface WatchSourceEnvironment {
  readonly createObjectURL: (file: File) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly createVideoElement: () => CapturableVideoElement;
}

const browserWatchSourceEnvironment = (): WatchSourceEnvironment => ({
  createObjectURL: (file) => URL.createObjectURL(file),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createVideoElement: () => document.createElement('video') as CapturableVideoElement,
});

const sourceError = (operation: WebWatchSourceError['operation'], cause: unknown) =>
  new WebWatchSourceError({ operation, cause });

const trySource = <A>(
  operation: WebWatchSourceError['operation'],
  evaluate: () => A,
): Effect.Effect<A, WebWatchSourceError> =>
  Effect.try({ try: evaluate, catch: (cause) => sourceError(operation, cause) });

const trySourcePromise = <A>(
  operation: WebWatchSourceError['operation'],
  evaluate: () => Promise<A>,
): Effect.Effect<A, WebWatchSourceError> =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => sourceError(operation, cause) });

export const waitForWatchSourceReady = (
  element: HTMLMediaElement,
): Effect.Effect<void, WebWatchSourceError> => {
  if (element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Effect.void;
  return Effect.callback<void, WebWatchSourceError>((resume) => {
    const cleanup = () => {
      element.removeEventListener('canplay', handleReady);
      element.removeEventListener('error', handleError);
    };
    const handleReady = () => {
      cleanup();
      resume(Effect.void);
    };
    const handleError = () => {
      cleanup();
      resume(Effect.fail(sourceError('prepare', element.error ?? 'decode-error')));
    };
    element.addEventListener('canplay', handleReady);
    element.addEventListener('error', handleError);
    return Effect.sync(cleanup);
  });
};

export interface WebWatchSourceResource {
  readonly element: CapturableVideoElement;
  readonly stream: MediaStream;
  readonly claim: Effect.Effect<ClaimedSourceHandle, WebWatchSourceError, Scope.Scope>;
  readonly cancel: Effect.Effect<void>;
  readonly play: Effect.Effect<void, WebWatchSourceError>;
  readonly pause: Effect.Effect<void, WebWatchSourceError>;
  readonly seek: (progress: number) => Effect.Effect<void, WebWatchSourceError>;
  readonly primeFirstFrame: Effect.Effect<void, WebWatchSourceError>;
  readonly observe: (
    dispatch: (input: WatchSourceEvent) => void,
  ) => Effect.Effect<void, WebWatchSourceError, Scope.Scope>;
}

const isWebWatchSourceResource = (value: unknown): value is WebWatchSourceResource =>
  typeof value === 'object' && value !== null && 'claim' in value && 'stream' in value;

export const webWatchSourceResource = (
  source: PreparedSourceHandle | ClaimedSourceHandle,
): WebWatchSourceResource | null => (isWebWatchSourceResource(source.value) ? source.value : null);

export interface PreparedWebWatchSource {
  readonly source: PreparedSourceHandle;
  readonly cancel: () => Promise<void>;
}

const acquireWatchSource = Effect.fn('acquireWatchSource')(function* (
  file: File,
  environment: WatchSourceEnvironment,
) {
  const objectUrl = yield* Effect.acquireRelease(
    trySource('prepare', () => environment.createObjectURL(file)),
    (url) => Effect.sync(() => environment.revokeObjectURL(url)),
  );
  const element = yield* Effect.acquireRelease(
    trySource('prepare', environment.createVideoElement),
    (element) =>
      Effect.sync(() => {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }),
  );

  yield* trySource('prepare', () => {
    element.preload = 'auto';
    element.playsInline = true;
    element.muted = false;
    element.volume = 1;
  });
  if (file.type !== '' && element.canPlayType(file.type) === '') {
    return yield* sourceError('prepare', `Unsupported media type: ${file.type}`);
  }
  yield* trySource('prepare', () => {
    element.src = objectUrl;
    element.load();
  });
  yield* waitForWatchSourceReady(element);

  const stream = yield* Effect.acquireRelease(
    trySource('prepare', () => element.captureStream()),
    (stream) =>
      Effect.sync(() => {
        for (const track of stream.getTracks()) track.stop();
      }),
  );
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack === undefined) {
    return yield* sourceError('prepare', 'captureStream() did not expose a video track');
  }
  yield* trySource('prepare', () => {
    videoTrack.contentHint = 'detail';
  });

  return { element, stream };
});

const observeWatchSource = (
  element: CapturableVideoElement,
  dispatch: (input: WatchSourceEvent) => void,
): Effect.Effect<void, WebWatchSourceError, Scope.Scope> =>
  Effect.gen(function* () {
    const listeners = [
      ['playing', () => dispatch({ _tag: 'SourcePlaying' })],
      ['ended', () => dispatch({ _tag: 'SourceEnded' })],
      ['error', () => dispatch({ _tag: 'SourceFailed' })],
    ] as const;

    yield* Effect.acquireRelease(
      trySource('observe', () => {
        for (const [type, listener] of listeners) element.addEventListener(type, listener);
      }),
      () =>
        Effect.sync(() => {
          for (const [type, listener] of listeners) element.removeEventListener(type, listener);
        }),
    );
  });

export const prepareWatchSourceWith = Effect.fn('prepareWatchSourceWith')(function* (
  file: File,
  environment: WatchSourceEnvironment,
) {
  const resourceScope = yield* Scope.make();
  const { element, stream } = yield* acquireWatchSource(file, environment).pipe(
    Scope.provide(resourceScope),
    Effect.onError(() => Scope.close(resourceScope, Exit.void)),
  );

  let ownership: 'prepared' | 'claimed' | 'released' = 'prepared';
  const close = Effect.suspend(() => {
    ownership = 'released';
    return Scope.close(resourceScope, Exit.void);
  });
  let resource: WebWatchSourceResource;
  const claim = Effect.acquireRelease(
    Effect.suspend(() => {
      if (ownership !== 'prepared') {
        return Effect.fail(sourceError('claim', 'Source was already claimed'));
      }
      ownership = 'claimed';
      return Effect.succeed({
        _tag: 'ClaimedSource',
        value: resource,
      } satisfies ClaimedSourceHandle);
    }),
    () => close,
  );

  resource = {
    element,
    stream,
    claim,
    cancel: Effect.suspend(() => (ownership === 'prepared' ? close : Effect.void)),
    play: trySourcePromise('play', () => element.play()),
    pause: trySource('pause', () => element.pause()),
    seek: (progress) =>
      trySource('seek', () => {
        if (!Number.isFinite(element.duration) || element.duration <= 0) {
          throw new Error('Source duration is unavailable');
        }
        element.currentTime = Math.min(1, Math.max(0, progress)) * element.duration;
      }),
    primeFirstFrame: trySource('prime', () => {
      element.currentTime = Number(element.currentTime);
    }),
    observe: (dispatch) => observeWatchSource(element, dispatch),
  };

  return {
    source: { _tag: 'PreparedSource', value: resource },
    cancel: () => Effect.runPromise(resource.cancel),
  } satisfies PreparedWebWatchSource;
});

export const prepareWatchSource = (file: File) =>
  prepareWatchSourceWith(file, browserWatchSourceEnvironment());

export const programStreamHandle = (resource: WebWatchSourceResource): ProgramStreamHandle => ({
  value: resource.stream,
});

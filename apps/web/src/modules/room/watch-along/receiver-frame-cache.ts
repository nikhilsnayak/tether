import type { WatchSessionView } from '@tether/client-runtime/modules/watch-along';
import { Data, Effect } from 'effect';

export class ReceiverFrameCacheError extends Data.TaggedError('ReceiverFrameCacheError')<{
  readonly operation: 'create' | 'draw' | 'commit';
  readonly cause: unknown;
}> {}

export interface DecodedVideoFrame {
  readonly videoWidth: number;
  readonly videoHeight: number;
}

export interface ReceiverFrameMetadata {
  readonly presentedFrames: number;
}

export interface ReceiverFrameCache {
  readonly canvas: HTMLCanvasElement;
  readonly capture: (
    frame: CanvasImageSource & DecodedVideoFrame,
    metadata: ReceiverFrameMetadata,
    view: WatchSessionView,
  ) => Effect.Effect<boolean, ReceiverFrameCacheError>;
  readonly armSeek: (baseRevision: number, target: number, view: WatchSessionView) => void;
  readonly acceptView: (view: WatchSessionView) => Effect.Effect<boolean, ReceiverFrameCacheError>;
  readonly hasFrame: () => boolean;
  readonly dispose: () => void;
}

export interface ReceiverFrameCacheEnvironment {
  readonly createCanvas: () => HTMLCanvasElement;
}

const browserReceiverFrameCacheEnvironment: ReceiverFrameCacheEnvironment = {
  createCanvas: () => document.createElement('canvas'),
};

const resizeAndDraw = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
) => {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
};

export const containVideoSize = (
  source: readonly [number, number],
  bounds: readonly [number, number],
): readonly [number, number] => {
  if (source[0] <= 0 || source[1] <= 0 || bounds[0] <= 0 || bounds[1] <= 0) return [0, 0];
  const scale = Math.min(bounds[0] / source[0], bounds[1] / source[1]);
  return [source[0] * scale, source[1] * scale];
};

export const createReceiverFrameCacheWith = Effect.fn('createReceiverFrameCacheWith')(function* (
  environment: ReceiverFrameCacheEnvironment,
) {
  const canvas = yield* Effect.try({
    try: environment.createCanvas,
    catch: (cause) => new ReceiverFrameCacheError({ operation: 'create', cause }),
  });
  const candidate = yield* Effect.try({
    try: environment.createCanvas,
    catch: (cause) => new ReceiverFrameCacheError({ operation: 'create', cause }),
  });
  const context = canvas.getContext('2d');
  const candidateContext = candidate.getContext('2d');
  if (context === null || candidateContext === null) {
    return yield* new ReceiverFrameCacheError({
      operation: 'create',
      cause: 'Canvas 2D is unavailable',
    });
  }

  let committed = false;
  let candidateReady = false;
  let disposed = false;
  let lastPresentedFrames = -1;
  let pendingSeek: {
    readonly revision: number;
    readonly target: number;
    readonly baseline: WatchSessionView;
  } | null = null;
  let acceptNextRevision: number | null = null;
  let captureFinalFrame = false;
  let previousStatus: WatchSessionView['status'] = 'idle';

  const draw = (
    target: HTMLCanvasElement,
    targetContext: CanvasRenderingContext2D,
    frame: CanvasImageSource & DecodedVideoFrame,
    operation: ReceiverFrameCacheError['operation'],
    onDraw: () => boolean,
  ) =>
    Effect.try({
      try: () => {
        resizeAndDraw(target, targetContext, frame, frame.videoWidth, frame.videoHeight);
        return onDraw();
      },
      catch: (cause) => new ReceiverFrameCacheError({ operation, cause }),
    });

  const capture: ReceiverFrameCache['capture'] = (frame, metadata, view) => {
    if (
      disposed ||
      frame.videoWidth <= 0 ||
      frame.videoHeight <= 0 ||
      metadata.presentedFrames <= lastPresentedFrames
    ) {
      return Effect.succeed(false);
    }
    lastPresentedFrames = metadata.presentedFrames;
    if (pendingSeek !== null) {
      return draw(candidate, candidateContext, frame, 'draw', () => {
        candidateReady = true;
        return false;
      });
    }
    const acceptsRevision = acceptNextRevision === view.revision;
    if (
      committed &&
      view.status !== 'playing' &&
      view.status !== 'buffering' &&
      !acceptsRevision &&
      !captureFinalFrame
    ) {
      return Effect.succeed(false);
    }
    return draw(canvas, context, frame, 'draw', () => {
      committed = true;
      if (acceptsRevision) acceptNextRevision = null;
      captureFinalFrame = false;
      return true;
    });
  };

  const acceptView: ReceiverFrameCache['acceptView'] = (view) => {
    captureFinalFrame =
      (previousStatus === 'playing' || previousStatus === 'buffering') && view.status === 'ended';
    previousStatus = view.status;
    if (pendingSeek === null) return Effect.succeed(false);
    if (view === pendingSeek.baseline && view.revision < pendingSeek.revision) {
      return Effect.succeed(false);
    }
    if (view.revision < pendingSeek.revision) {
      if (view.progress !== pendingSeek.target) {
        pendingSeek = null;
        candidateReady = false;
      }
      return Effect.succeed(false);
    }
    pendingSeek = null;
    if (!candidateReady) {
      acceptNextRevision = view.revision;
      return Effect.succeed(false);
    }
    candidateReady = false;
    return Effect.try({
      try: () => {
        resizeAndDraw(canvas, context, candidate, candidate.width, candidate.height);
        committed = true;
        return true;
      },
      catch: (cause) => new ReceiverFrameCacheError({ operation: 'commit', cause }),
    });
  };

  return {
    canvas,
    capture,
    armSeek: (baseRevision, target, view) => {
      pendingSeek = { revision: baseRevision + 1, target, baseline: view };
      candidateReady = false;
      acceptNextRevision = null;
    },
    acceptView,
    hasFrame: () => committed,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      canvas.width = 0;
      canvas.height = 0;
      candidate.width = 0;
      candidate.height = 0;
    },
  } satisfies ReceiverFrameCache;
});

export const createReceiverFrameCache = (): ReceiverFrameCache =>
  createReceiverFrameCacheWith(browserReceiverFrameCacheEnvironment).pipe(Effect.runSync);

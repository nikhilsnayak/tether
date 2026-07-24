import { Crypto, Effect, Exit, Scope } from 'effect';

import type { WatchActorInput, WatchActorInputDispatch } from './ActorModel';
import type {
  ClaimedSourceHandle,
  PreparedSourceHandle,
  ProgramStreamHandle,
  WatchSessionView,
} from './Model';
import {
  WATCH_PROTOCOL_VERSION,
  WatchSessionId,
  type PlaybackStateChanged,
  type WatchControlCommand,
  type WatchMessage,
  type WatchStatus,
} from './Protocol';
import {
  WatchAlongPlatform,
  WatchEventSink,
  WatchLocalCapabilities,
  WatchTransport,
  isWatchPlatformError,
} from './Services';

const WATCH_MEDIA_CHUNK_BYTES = 16 * 1024;

interface SessionBase {
  readonly watchSessionId: WatchSessionId;
  readonly role: 'presenter' | 'watcher';
  readonly status: WatchStatus;
}

interface PresenterSession extends SessionBase {
  readonly role: 'presenter';
  readonly source: ClaimedSourceHandle;
  readonly scope: Scope.Closeable;
}

interface WatcherSession extends SessionBase {
  readonly role: 'watcher';
}

type Session = PresenterSession | WatcherSession;
type State =
  | { readonly _tag: 'Unavailable' }
  | { readonly _tag: 'Idle' }
  | {
      readonly _tag: 'Preparing';
      readonly watchSessionId: WatchSessionId;
      readonly source: PreparedSourceHandle;
      readonly scope: Scope.Closeable;
    }
  | { readonly _tag: 'Awaiting'; readonly watchSessionId: WatchSessionId }
  | { readonly _tag: 'Active'; readonly session: Session };

const blankView = (status: 'unavailable' | 'idle', canPresent: boolean): WatchSessionView => ({
  status,
  role: null,
  canPresent,
});

export const makeWatchActor = Effect.fnUntraced(function* (dispatch: WatchActorInputDispatch) {
  const platform = yield* WatchAlongPlatform;
  const transport = yield* WatchTransport;
  const capabilities = yield* WatchLocalCapabilities;
  const events = yield* WatchEventSink;
  const crypto = yield* Crypto.Crypto;
  const actorScope = yield* Scope.Scope;

  let state: State = { _tag: 'Unavailable' };
  let remoteStream: ProgramStreamHandle | null = null;
  let remoteStreamVersion = -1;
  // Transient watcher-side transfer counters (validation only; playback replaces
  // this in a later change).
  let mediaReceived = 0;
  let mediaExpected = 0;

  const send = (message: WatchMessage) => transport.sendDiscrete(message);
  const emitView = () => {
    let view: WatchSessionView;
    switch (state._tag) {
      case 'Unavailable':
        view = blankView('unavailable', false);
        break;
      case 'Idle':
        view = blankView('idle', capabilities.canPresentLocalFile);
        break;
      case 'Preparing':
        view = { status: 'preparing-local', role: 'presenter', canPresent: false };
        break;
      case 'Awaiting':
        view = { status: 'awaiting-remote-start', role: 'watcher', canPresent: false };
        break;
      case 'Active':
        view = { status: state.session.status, role: state.session.role, canPresent: false };
        break;
    }
    return events.emit({ _tag: 'WatchSessionChanged', view });
  };

  const playbackMessage = (session: Session): PlaybackStateChanged => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'playback-state-changed',
    watchSessionId: session.watchSessionId,
    status: session.status,
  });

  const releaseSession = Effect.fnUntraced(function* () {
    if (state._tag === 'Unavailable' || state._tag === 'Idle') return;
    if (state._tag === 'Preparing') {
      yield* Scope.close(state.scope, Exit.void);
    }
    if (state._tag === 'Active' && state.session.role === 'presenter') {
      yield* Scope.close(state.session.scope, Exit.void);
    }
    yield* platform.clearProgramTracks.pipe(Effect.ignore);
    yield* events.emit({ _tag: 'WatchProgramStreamCleared' }).pipe(Effect.ignore);
  });

  const reset = Effect.fnUntraced(function* (next: 'idle' | 'unavailable') {
    yield* releaseSession();
    state = next === 'idle' ? { _tag: 'Idle' } : { _tag: 'Unavailable' };
    yield* emitView();
  });

  const failPresenter = Effect.fnUntraced(function* (session: PresenterSession) {
    yield* send({
      version: WATCH_PROTOCOL_VERSION,
      type: 'watch-failed',
      watchSessionId: session.watchSessionId,
      reason: 'source',
    });
    yield* reset('idle');
  });

  const updatePresenter = Effect.fnUntraced(function* (
    session: PresenterSession,
    control: WatchControlCommand,
  ) {
    if (control.kind === 'eject') {
      yield* send({
        version: WATCH_PROTOCOL_VERSION,
        type: 'watch-ended',
        watchSessionId: session.watchSessionId,
      });
      return yield* reset('idle');
    }

    if (control.kind === 'play') yield* platform.play(session.source);
    if (control.kind === 'pause') yield* platform.pause(session.source);
    if (control.kind === 'replay') yield* platform.replay(session.source);
    const next: PresenterSession = {
      ...session,
      status: control.kind === 'pause' ? 'loaded-paused' : 'playing',
    };
    state = { _tag: 'Active', session: next };
    yield* send(playbackMessage(next));
    yield* emitView();
  });

  const requestControl = Effect.fnUntraced(function* (control: WatchControlCommand) {
    if (state._tag !== 'Active') return;
    if (state.session.role === 'presenter') {
      const session = state.session;
      yield* updatePresenter(session, control).pipe(
        Effect.catchIf(isWatchPlatformError, () => failPresenter(session)),
      );
      return;
    }
    yield* send({
      version: WATCH_PROTOCOL_VERSION,
      type: 'control-requested',
      watchSessionId: state.session.watchSessionId,
      control,
    });
  });

  // Streams the source file byte range by range over watch-media. Backpressure
  // lives in the transport, so this just reads and sends until the file is done.
  const pumpMedia = (source: ClaimedSourceHandle, byteLength: number) => {
    const step = (offset: number): Effect.Effect<void, unknown> =>
      offset >= byteLength
        ? Effect.void
        : platform.readSourceBytes(source, offset, WATCH_MEDIA_CHUNK_BYTES).pipe(
            Effect.flatMap((chunk) => {
              if (chunk.byteLength === 0) return Effect.void;
              const buffer = chunk.buffer.slice(
                chunk.byteOffset,
                chunk.byteOffset + chunk.byteLength,
              ) as ArrayBuffer;
              return transport.sendMedia(buffer).pipe(
                Effect.andThen(step(offset + chunk.byteLength)),
              );
            }),
          );
    return step(0);
  };

  const startPresenting = Effect.fnUntraced(function* (
    preparing: Extract<State, { readonly _tag: 'Preparing' }>,
  ) {
    const { watchSessionId, source } = preparing;
    const sourceScope = yield* Scope.make();
    yield* Scope.addFinalizer(actorScope, Scope.close(sourceScope, Exit.void));

    yield* Effect.gen(function* () {
      const claimed = yield* platform.claimSource(source).pipe(Scope.provide(sourceScope));
      yield* Scope.close(preparing.scope, Exit.void);
      const stream = yield* platform.programStream(claimed);
      yield* platform.attachProgramTracks(stream);
      yield* platform.observeSource(claimed, dispatch).pipe(Scope.provide(sourceScope));
      yield* platform.primeFirstFrame(claimed);
      const session: PresenterSession = {
        role: 'presenter',
        watchSessionId,
        status: 'loaded-paused',
        source: claimed,
        scope: sourceScope,
      };
      state = { _tag: 'Active', session };
      yield* send(playbackMessage(session));
      yield* events.emit({ _tag: 'WatchProgramStreamReady', stream });
      yield* emitView();
      // Announce the transfer, then stream the bytes on a fiber scoped to the
      // session so it is cancelled on eject, source end, or failure.
      const info = yield* platform.sourceMediaInfo(claimed);
      yield* send({
        version: WATCH_PROTOCOL_VERSION,
        type: 'media-offer',
        watchSessionId,
        byteLength: info.byteLength,
        mimeType: info.mimeType,
      });
      yield* pumpMedia(claimed, info.byteLength).pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug('watch-media pump stopped').pipe(
            Effect.annotateLogs('cause', String(cause)),
          ),
        ),
        Effect.forkIn(sourceScope),
      );
    }).pipe(
      Effect.catchIf(isWatchPlatformError, () =>
        Effect.gen(function* () {
          yield* Scope.close(sourceScope, Exit.void);
          yield* Scope.close(preparing.scope, Exit.void);
          yield* platform.clearProgramTracks.pipe(Effect.ignore);
          yield* send({
            version: WATCH_PROTOCOL_VERSION,
            type: 'watch-failed',
            watchSessionId,
            reason: 'source',
          });
          state = { _tag: 'Idle' };
          yield* emitView();
        }),
      ),
    );
  });

  const acceptRemotePlayback = Effect.fnUntraced(function* (message: PlaybackStateChanged) {
    const matchesAwaiting =
      state._tag === 'Awaiting' && state.watchSessionId === message.watchSessionId;
    const matchesActive =
      state._tag === 'Active' &&
      state.session.role === 'watcher' &&
      state.session.watchSessionId === message.watchSessionId;
    if (!matchesAwaiting && !matchesActive) return;
    state = {
      _tag: 'Active',
      session: {
        role: 'watcher',
        watchSessionId: message.watchSessionId,
        status: message.status,
      },
    };
    if (remoteStream !== null) {
      yield* events.emit({ _tag: 'WatchProgramStreamReady', stream: remoteStream });
    }
    yield* emitView();
  });

  const handleRemote = Effect.fnUntraced(function* (message: WatchMessage) {
    switch (message.type) {
      case 'hello': {
        if (state._tag !== 'Unavailable') return;
        const compatible =
          capabilities.canReceiveProgramMedia &&
          capabilities.canRenderWatch &&
          capabilities.canControlWatch &&
          message.canReceiveProgramMedia &&
          message.canRenderWatch &&
          message.canControlWatch &&
          (capabilities.canPresentLocalFile || message.canPresentLocalFile);
        if (!compatible) return;
        state = { _tag: 'Idle' };
        return yield* emitView();
      }
      case 'watch-proposed':
        if (state._tag === 'Unavailable') return;
        if (state._tag !== 'Idle') {
          return yield* send({
            version: WATCH_PROTOCOL_VERSION,
            type: 'watch-rejected',
            watchSessionId: message.watchSessionId,
            reason: 'busy',
          });
        }
        state = { _tag: 'Awaiting', watchSessionId: message.watchSessionId };
        yield* send({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ready',
          watchSessionId: message.watchSessionId,
        });
        return yield* emitView();
      case 'watch-ready':
        if (state._tag === 'Preparing' && state.watchSessionId === message.watchSessionId) {
          return yield* startPresenting(state);
        }
        return;
      case 'watch-rejected':
        if (state._tag === 'Preparing' && state.watchSessionId === message.watchSessionId) {
          return yield* reset('idle');
        }
        return;
      case 'playback-state-changed':
        return yield* acceptRemotePlayback(message);
      case 'control-requested':
        if (
          state._tag === 'Active' &&
          state.session.role === 'presenter' &&
          state.session.watchSessionId === message.watchSessionId
        ) {
          const session = state.session;
          return yield* updatePresenter(session, message.control).pipe(
            Effect.catchIf(isWatchPlatformError, () => failPresenter(session)),
          );
        }
        return;
      case 'watch-ended':
      case 'watch-failed':
        if (
          ((state._tag === 'Preparing' || state._tag === 'Awaiting') &&
            state.watchSessionId === message.watchSessionId) ||
          (state._tag === 'Active' && state.session.watchSessionId === message.watchSessionId)
        ) {
          return yield* reset('idle');
        }
        return;
      case 'media-offer':
        mediaExpected = message.byteLength;
        mediaReceived = 0;
        return yield* Effect.logDebug('watch-media offer received').pipe(
          Effect.annotateLogs({ byteLength: message.byteLength, mimeType: message.mimeType }),
        );
    }
  });

  const handleSourceEvent = Effect.fnUntraced(function* (input: WatchActorInput) {
    if (state._tag !== 'Active' || state.session.role !== 'presenter') return;
    if (input._tag === 'SourceFailed') {
      yield* send({
        version: WATCH_PROTOCOL_VERSION,
        type: 'watch-failed',
        watchSessionId: state.session.watchSessionId,
        reason: 'source',
      });
      return yield* reset('idle');
    }
    const next = {
      ...state.session,
      status: 'ended' as const,
    };
    state = { _tag: 'Active', session: next };
    yield* send(playbackMessage(next));
    yield* emitView();
  });

  const handleInput = Effect.fnUntraced(function* (input: WatchActorInput) {
    switch (input._tag) {
      case 'ChannelOpened':
        return yield* send({ version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities });
      case 'ChannelClosed':
        if (state._tag === 'Unavailable') return;
        return yield* reset('unavailable');
      case 'RemoteMessage':
        return yield* handleRemote(input.message);
      case 'ProposeLocalSource': {
        if (state._tag !== 'Idle' || !capabilities.canPresentLocalFile) {
          return yield* platform.cancelPreparedSource(input.source).pipe(Effect.ignore);
        }
        const preparingScope = yield* Scope.fork(actorScope);
        yield* Scope.addFinalizer(
          preparingScope,
          platform.cancelPreparedSource(input.source).pipe(Effect.ignore),
        );
        state = {
          _tag: 'Preparing',
          watchSessionId: WatchSessionId.make(yield* crypto.randomUUIDv4),
          source: input.source,
          scope: preparingScope,
        };
        yield* send({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-proposed',
          watchSessionId: state.watchSessionId,
        });
        return yield* emitView();
      }
      case 'RequestControl':
        return yield* requestControl(input.control);
      case 'Cancel':
        if (state._tag === 'Active') return yield* requestControl({ kind: 'eject' });
        if (state._tag === 'Preparing' || state._tag === 'Awaiting') {
          yield* send({
            version: WATCH_PROTOCOL_VERSION,
            type: 'watch-ended',
            watchSessionId: state.watchSessionId,
          });
          return yield* reset('idle');
        }
        return;
      case 'RemoteProgramStreamChanged':
        if (input.version <= remoteStreamVersion) return;
        remoteStreamVersion = input.version;
        remoteStream = input.stream;
        if (state._tag === 'Active' && state.session.role === 'watcher') {
          yield* events.emit(
            input.stream === null
              ? { _tag: 'WatchProgramStreamCleared' }
              : { _tag: 'WatchProgramStreamReady', stream: input.stream },
          );
        }
        return;
      case 'SourceEnded':
      case 'SourceFailed':
        return yield* handleSourceEvent(input);
      case 'WatchMediaChunkReceived': {
        mediaReceived += input.chunk.byteLength;
        if (mediaExpected === 0 || mediaReceived < mediaExpected) return;
        const total = mediaReceived;
        mediaExpected = 0;
        return yield* Effect.logDebug('watch-media transfer complete').pipe(
          Effect.annotateLogs({ received: total }),
        );
      }
    }
  });

  return { handleInput };
});

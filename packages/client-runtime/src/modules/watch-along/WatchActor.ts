import { Crypto, Duration, Effect, Exit, Scope } from 'effect';

import type {
  ActiveWatchSession,
  PresenterWatchSession,
  WatchActorInputDispatch,
  WatchActorState,
  WatcherWatchSession,
} from './ActorModel';
import type { PreparedSourceHandle, ProgramStreamHandle, WatchSessionView } from './Model';
import {
  WATCH_PROTOCOL_VERSION,
  WatchSessionId,
  type BufferingReason,
  type ControlRejected,
  type ControlRequested,
  type FailureReason,
  type Hello,
  type PlaybackStateChanged,
  type ProgressSample,
  type RejectionReason,
  type WatchControlCommand,
  type WatchEnded,
  type WatchFailed,
  type WatchMessage,
  type WatchProposed,
  type WatchReady,
  type WatchRejected,
  type WatchStarted,
  type WatchStatus,
} from './Protocol';
import {
  WatchAlongPlatform,
  WatchEventSink,
  WatchLocalCapabilities,
  type WatchPlatformError,
  WatchTransport,
} from './Services';
import { makeWatchActorMemory } from './WatchActorMemory';

const NO_STREAM_BASELINE = -1;
const PROGRESS_SAMPLE_INTERVAL = Duration.millis(500);
const RESTORE_DEADLINE = Duration.seconds(10);

/**
 * The supervised watch-along actor: capability negotiation, presenter proposal
 * arbitration, watch-session identity, canonical playback state, and feature
 * failure. One serialized mutable `state`; the supervisor (plan 006) owns its
 * lifetime and pipes decoded wire messages, source events, and lifecycle
 * inputs through `handleInput`.
 *
 * ```text
 * INPUTS                                  SERIALIZED PROCESSOR
 * decoded wire message -> RemoteMessage -----+
 * source callback ------> WatchSourceEvent --+
 * room UI commands -----> Propose / Request -+--> mailbox --> actor
 * lifecycle ------------> Channel/Transport -+
 *
 * ACTOR OUTPUTS
 * actor --> WatchTransport ----> discrete control messages + progress samples
 *       --> WatchAlongPlatform -> claim / play / pause / seek / program tracks
 *       --> WatchEventSink ------> UI projection events
 *
 * SESSION FLOW
 *
 * [Unavailable]  ChannelOpened sends hello; incompatible Hello stays here.
 *      |
 *      +-- Hello(compatible) ------------------------------> [Idle]
 *
 * [Idle]
 *   +-- ProposeLocalSource ----------------> [PreparingLocal] (presenter)
 *   |        WatchReady --> claim+attach --> [LoadedPaused] (or Idle on fail)
 *   |        WatchRejected / CancelPreparing --> [Idle]
 *   |        peer WatchProposed: host rejects & stays; guest yields to watcher
 *   |
 *   +-- WatchProposed ---------------------> [AwaitingRemoteStart] (watcher)
 *            WatchStarted marks started; PlaybackStateChanged adopts canonical
 *
 * Both roles converge on the active playback cluster:
 *
 *          play                 SourceBuffering
 *   [LoadedPaused] -------> [Playing] ---------------> [Buffering]
 *          ^   <---------------- pause <---- SourcePlaying ---+
 *          |                        |
 *          |                    SourceEnded
 *          |     replay             v
 *          +------------------- [Ended]
 *
 *   The presenter owns the canonical revision: commitPresenter bumps it and
 *   broadcasts every change. A watcher applies canonical PlaybackStateChanged
 *   guarded session-id -> authority-epoch -> revision, previewing its own
 *   RequestControl optimistically until the presenter's echo lands.
 *   eject / SourceFailed / RemoteWatchFailed / RemoteWatchEnded --> [Idle].
 *
 * INTERRUPTION & RECOVERY
 *   TransportInterrupted: a presenter pauses, bumps the authority epoch, marks
 *   the session interrupted, and parks in [LoadedPaused]/[Ended];
 *   TransportRestored rebroadcasts. A watcher parks in
 *   [AwaitingRecoverySnapshot] until a higher-epoch PlaybackStateChanged.
 *   BackgroundThrottled: [Playing] -> [Buffering(background-throttled)];
 *   ForegroundRestored resumes, RestoreDeadlineElapsed fails to [Idle].
 *
 * ChannelClosed and unrecoverable LocalPipelineFailed return any state to
 * [Unavailable].
 * ```
 */
const makeWatchActor = Effect.fnUntraced(function* (dispatchInput: WatchActorInputDispatch) {
  const platform = yield* WatchAlongPlatform;
  const transport = yield* WatchTransport;
  const localCapabilities = yield* WatchLocalCapabilities;
  const eventSink = yield* WatchEventSink;
  const crypto = yield* Crypto.Crypto;
  const actorScope = yield* Scope.Scope;
  const memory = makeWatchActorMemory();

  let state: WatchActorState = { _tag: 'Unavailable' };

  const toIdle = (): WatchActorState => ({ _tag: 'Idle' });

  const projectView = (): WatchSessionView => {
    switch (state._tag) {
      case 'Unavailable':
        return blankView('unavailable', false);
      case 'Idle':
        return blankView('idle', localCapabilities.canPresentLocalFile);
      case 'PreparingLocal':
        return { ...blankView('preparing-local', false), role: 'presenter' };
      case 'AwaitingRemoteStart':
        return { ...blankView('awaiting-remote-start', false), role: 'watcher' };
      case 'AwaitingRecoverySnapshot':
        return sessionView(state.session, 'awaiting-recovery-snapshot', false, null);
      case 'LoadedPaused':
        return sessionView(state.session, 'loaded-paused', !state.session.interrupted, null);
      case 'Playing':
        return sessionView(state.session, 'playing', !state.session.interrupted, null);
      case 'Buffering':
        return sessionView(state.session, 'buffering', !state.session.interrupted, state.reason);
      case 'Ended':
        return sessionView(state.session, 'ended', !state.session.interrupted, null);
    }
  };

  const emitView = () => eventSink.emit({ _tag: 'WatchSessionChanged', view: projectView() });
  const emitAvailability = (available: boolean) =>
    eventSink.emit({ _tag: 'WatchAvailabilityChanged', available });

  const sendDiscrete = (message: WatchMessage) =>
    transport
      .sendDiscrete(message)
      .pipe(
        Effect.catchTag('WatchTransportError', (error) =>
          Effect.logWarning('Failed to send watch control message').pipe(
            Effect.annotateLogs('cause', String(error.cause)),
          ),
        ),
      );

  const offerLatestProgress = (message: ProgressSample) =>
    transport
      .offerLatestProgress(message)
      .pipe(
        Effect.catchTag('WatchTransportError', (error) =>
          Effect.logWarning('Failed to send watch progress sample').pipe(
            Effect.annotateLogs('cause', String(error.cause)),
          ),
        ),
      );

  const cancelPrepared = (source: PreparedSourceHandle) =>
    platform
      .cancelPreparedSource(source)
      .pipe(
        Effect.catchTag('WatchPlatformError', (error) =>
          Effect.logWarning('Failed to release prepared source').pipe(
            Effect.annotateLogs('operation', error.operation),
          ),
        ),
      );

  const clearTracksQuietly = () =>
    platform.clearProgramTracks.pipe(
      Effect.catchTag('WatchPlatformError', (error) =>
        Effect.logWarning('Failed to clear program tracks').pipe(
          Effect.annotateLogs('operation', error.operation),
        ),
      ),
    );

  const hello = (): Hello => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'hello',
    ...localCapabilities,
  });
  const watchProposed = (watchSessionId: WatchSessionId): WatchProposed => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'watch-proposed',
    watchSessionId,
  });
  const watchReady = (watchSessionId: WatchSessionId): WatchReady => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'watch-ready',
    watchSessionId,
  });
  const watchRejected = (
    watchSessionId: WatchSessionId,
    reason: RejectionReason,
  ): WatchRejected => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'watch-rejected',
    watchSessionId,
    reason,
  });
  const watchStarted = (watchSessionId: WatchSessionId): WatchStarted => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'watch-started',
    watchSessionId,
  });
  const playbackState = (
    session: ActiveWatchSession,
    status: WatchStatus,
    reason?: BufferingReason,
  ): PlaybackStateChanged => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'playback-state-changed',
    watchSessionId: session.watchSessionId,
    authorityEpoch: session.authorityEpoch,
    revision: session.revision,
    status,
    ...(reason !== undefined ? { reason } : {}),
    progress: session.progress,
  });
  const controlRequested = (
    session: ActiveWatchSession,
    control: WatchControlCommand,
  ): ControlRequested => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'control-requested',
    watchSessionId: session.watchSessionId,
    authorityEpoch: session.authorityEpoch,
    baseRevision: session.revision,
    control,
  });
  const controlRejected = (session: ActiveWatchSession): ControlRejected => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'control-rejected',
    watchSessionId: session.watchSessionId,
    authorityEpoch: session.authorityEpoch,
    baseRevision: session.revision,
  });
  const progressSample = (session: ActiveWatchSession, sequence: number): ProgressSample => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'progress-sample',
    watchSessionId: session.watchSessionId,
    authorityEpoch: session.authorityEpoch,
    revision: session.revision,
    sequence,
    progress: session.progress,
  });
  const watchEnded = (watchSessionId: WatchSessionId): WatchEnded => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'watch-ended',
    watchSessionId,
  });

  const stateFromStatus = (
    session: ActiveWatchSession,
    status: WatchStatus,
    reason: BufferingReason | undefined,
  ): WatchActorState => {
    switch (status) {
      case 'loaded-paused':
        return { _tag: 'LoadedPaused', session };
      case 'playing':
        return { _tag: 'Playing', session };
      case 'buffering':
        return { _tag: 'Buffering', session, reason: reason ?? 'source' };
      case 'ended':
        return { _tag: 'Ended', session };
    }
  };

  // Releases what the current state owns before a reset.
  const releaseSessionResources = Effect.fnUntraced(function* () {
    switch (state._tag) {
      case 'PreparingLocal':
        yield* cancelPrepared(state.preparedSource);
        return;
      case 'LoadedPaused':
      case 'Playing':
      case 'Buffering':
      case 'Ended':
        if (state.session.role === 'presenter') {
          yield* clearTracksQuietly();
          yield* Scope.close(state.session.sourceScope, Exit.void);
        }
        yield* eventSink.emit({ _tag: 'WatchProgramStreamCleared' });
        return;
      case 'AwaitingRecoverySnapshot':
        yield* eventSink.emit({ _tag: 'WatchProgramStreamCleared' });
        return;
      // Unavailable never reaches release: nothing is owned before capability.
      /* v8 ignore next */
      case 'Unavailable':
      case 'Idle':
      case 'AwaitingRemoteStart':
        return;
    }
  });

  const resetToIdle = Effect.fnUntraced(function* (failureReason?: FailureReason) {
    yield* releaseSessionResources();
    memory.remoteProgram.clear();
    memory.sampling.reset();
    state = toIdle();
    if (failureReason !== undefined) {
      yield* eventSink.emit({ _tag: 'WatchFailed', reason: failureReason });
    }
    yield* emitView();
  });

  // Startup failure paths release resources themselves, so this must not run
  // releaseSessionResources over the still-`PreparingLocal` state.
  const failStartup = Effect.fnUntraced(function* (reason: FailureReason) {
    memory.remoteProgram.clear();
    memory.sampling.reset();
    state = toIdle();
    yield* eventSink.emit({ _tag: 'WatchFailed', reason });
    yield* emitView();
  });

  const teardownUnavailable = Effect.fnUntraced(function* (failureReason?: FailureReason) {
    yield* releaseSessionResources();
    memory.remoteProgram.clear();
    memory.sampling.reset();
    state = { _tag: 'Unavailable' };
    yield* emitAvailability(false);
    if (failureReason !== undefined) {
      yield* eventSink.emit({ _tag: 'WatchFailed', reason: failureReason });
    }
    yield* emitView();
  });

  const failActiveSession = Effect.fnUntraced(function* (
    watchSessionId: WatchSessionId,
    reason: FailureReason,
  ) {
    yield* sendDiscrete({
      version: WATCH_PROTOCOL_VERSION,
      type: 'watch-failed',
      watchSessionId,
      reason,
    });
    yield* resetToIdle(reason);
  });

  const currentSessionId = (): WatchSessionId | null => {
    switch (state._tag) {
      case 'PreparingLocal':
      case 'AwaitingRemoteStart':
        return state.watchSessionId;
      case 'LoadedPaused':
      case 'Playing':
      case 'Buffering':
      case 'Ended':
      case 'AwaitingRecoverySnapshot':
        return state.session.watchSessionId;
      case 'Unavailable':
      case 'Idle':
        return null;
    }
  };

  const activeWatcherSessionId = (): WatchSessionId | null => {
    switch (state._tag) {
      case 'AwaitingRemoteStart':
        return state.watchSessionId;
      case 'AwaitingRecoverySnapshot':
        return state.session.watchSessionId;
      case 'LoadedPaused':
      case 'Playing':
      case 'Buffering':
      case 'Ended':
        return state.session.role === 'watcher' ? state.session.watchSessionId : null;
      default:
        return null;
    }
  };

  const isActiveWatcher = (): boolean => {
    switch (state._tag) {
      case 'LoadedPaused':
      case 'Playing':
      case 'Buffering':
      case 'Ended':
        return state.session.role === 'watcher';
      default:
        return false;
    }
  };

  const projectWatcherStream = () => {
    const cached = memory.remoteProgram.latest();
    const baseline = memory.remoteProgram.baseline();
    if (
      cached !== null &&
      cached.stream !== null &&
      baseline !== null &&
      cached.version > baseline
    ) {
      return eventSink.emit({ _tag: 'WatchProgramStreamReady', stream: cached.stream });
    }
    return Effect.void;
  };

  const beginPresenting = Effect.fnUntraced(function* (
    watchSessionId: WatchSessionId,
    preparedSource: PreparedSourceHandle,
  ) {
    const sourceScope = yield* Scope.fork(actorScope);
    const claimed = yield* platform.claimSource(preparedSource).pipe(
      Scope.provide(sourceScope),
      Effect.catchTag('WatchPlatformError', () => Effect.succeed(null)),
    );
    if (claimed === null) {
      yield* Scope.close(sourceScope, Exit.void);
      yield* cancelPrepared(preparedSource);
      yield* sendDiscrete({
        version: WATCH_PROTOCOL_VERSION,
        type: 'watch-failed',
        watchSessionId,
        reason: 'attachment',
      });
      return yield* failStartup('attachment');
    }

    const stream = yield* Effect.gen(function* () {
      yield* platform.observeSource(claimed, dispatchInput).pipe(Scope.provide(sourceScope));
      const programStream = yield* platform.programStream(claimed);
      yield* platform.attachProgramTracks(programStream);
      yield* platform.primeFirstFrame(claimed);
      return programStream;
    }).pipe(
      Effect.catchTag('WatchPlatformError', () => Effect.succeed<ProgramStreamHandle | null>(null)),
    );
    if (stream === null) {
      yield* clearTracksQuietly();
      yield* Scope.close(sourceScope, Exit.void);
      yield* sendDiscrete({
        version: WATCH_PROTOCOL_VERSION,
        type: 'watch-failed',
        watchSessionId,
        reason: 'attachment',
      });
      return yield* failStartup('attachment');
    }

    const session: PresenterWatchSession = {
      role: 'presenter',
      watchSessionId,
      revision: 0,
      authorityEpoch: 0,
      progress: 0,
      interrupted: false,
      source: claimed,
      sourceScope,
    };
    memory.sampling.reset();
    yield* sendDiscrete(watchStarted(watchSessionId));
    yield* sendDiscrete(playbackState(session, 'loaded-paused'));
    state = { _tag: 'LoadedPaused', session };
    yield* eventSink.emit({ _tag: 'WatchProgramStreamReady', stream });
    yield* emitView();
  });

  const acceptRemoteProposal = Effect.fnUntraced(function* (watchSessionId: WatchSessionId) {
    const baseline = memory.remoteProgram.latest()?.version ?? NO_STREAM_BASELINE;
    memory.remoteProgram.setBaseline(baseline);
    state = { _tag: 'AwaitingRemoteStart', watchSessionId, started: false };
    yield* sendDiscrete(watchReady(watchSessionId));
    yield* emitView();
  });

  const handleChannelOpened = Effect.fnUntraced(function* () {
    if (state._tag !== 'Unavailable') return;
    yield* sendDiscrete(hello());
  });

  const handleHello = Effect.fnUntraced(function* (message: Hello) {
    if (state._tag !== 'Unavailable') return;
    const compatible =
      localCapabilities.canReceiveProgramMedia &&
      localCapabilities.canRenderWatch &&
      localCapabilities.canControlWatch &&
      message.canReceiveProgramMedia &&
      message.canRenderWatch &&
      message.canControlWatch &&
      (localCapabilities.canPresentLocalFile || message.canPresentLocalFile);
    if (!compatible) {
      return yield* Effect.logInfo('Watch capabilities incompatible; staying unavailable');
    }
    state = toIdle();
    yield* emitAvailability(true);
    yield* emitView();
  });

  const handleChannelClosed = Effect.fnUntraced(function* () {
    if (state._tag === 'Unavailable') {
      return yield* Effect.logInfo('Watch channel closed before capability exchange');
    }
    yield* teardownUnavailable(state._tag === 'Idle' ? undefined : 'pipeline');
  });

  const handleProposeLocalSource = Effect.fnUntraced(function* (source: PreparedSourceHandle) {
    if (state._tag !== 'Idle' || !localCapabilities.canPresentLocalFile) {
      return yield* cancelPrepared(source);
    }
    const watchSessionId = WatchSessionId.make(yield* crypto.randomUUIDv4);
    state = { _tag: 'PreparingLocal', watchSessionId, preparedSource: source };
    yield* sendDiscrete(watchProposed(watchSessionId));
    yield* emitView();
  });

  const handleCancelPreparing = Effect.fnUntraced(function* () {
    if (state._tag !== 'PreparingLocal') return;
    yield* resetToIdle();
  });

  const handleWatchProposed = Effect.fnUntraced(function* (watchSessionId: WatchSessionId) {
    switch (state._tag) {
      case 'Idle':
        return yield* acceptRemoteProposal(watchSessionId);
      case 'PreparingLocal':
        if (transport.role === 'host') {
          return yield* sendDiscrete(watchRejected(watchSessionId, 'lost-arbitration'));
        }
        yield* cancelPrepared(state.preparedSource);
        return yield* acceptRemoteProposal(watchSessionId);
      case 'AwaitingRemoteStart':
      case 'AwaitingRecoverySnapshot':
      case 'LoadedPaused':
      case 'Playing':
      case 'Buffering':
      case 'Ended':
        return yield* sendDiscrete(watchRejected(watchSessionId, 'busy'));
      case 'Unavailable':
        return;
    }
  });

  const handleWatchReady = Effect.fnUntraced(function* (watchSessionId: WatchSessionId) {
    if (state._tag !== 'PreparingLocal' || state.watchSessionId !== watchSessionId) return;
    yield* beginPresenting(watchSessionId, state.preparedSource);
  });

  const handleWatchRejected = Effect.fnUntraced(function* (watchSessionId: WatchSessionId) {
    if (state._tag !== 'PreparingLocal' || state.watchSessionId !== watchSessionId) return;
    yield* resetToIdle();
  });

  const handleWatchStarted = (watchSessionId: WatchSessionId) =>
    Effect.sync(() => {
      if (
        state._tag !== 'AwaitingRemoteStart' ||
        state.watchSessionId !== watchSessionId ||
        state.started
      ) {
        return;
      }
      state = { ...state, started: true };
    });

  const presenterActiveSession = (): PresenterWatchSession | null => {
    switch (state._tag) {
      case 'LoadedPaused':
      case 'Playing':
      case 'Buffering':
      case 'Ended':
        return state.session.role === 'presenter' ? state.session : null;
      default:
        return null;
    }
  };

  const watcherActiveSession = (): WatcherWatchSession | null => {
    switch (state._tag) {
      case 'LoadedPaused':
      case 'Playing':
      case 'Buffering':
      case 'Ended':
        return state.session.role === 'watcher' ? state.session : null;
      default:
        return null;
    }
  };

  const adoptWatcherCanonical = (message: PlaybackStateChanged) => {
    const session: WatcherWatchSession = {
      role: 'watcher',
      watchSessionId: message.watchSessionId,
      revision: message.revision,
      authorityEpoch: message.authorityEpoch,
      progress: message.progress,
      interrupted: false,
    };
    memory.sampling.resetInbound();
    state = stateFromStatus(session, message.status, message.reason);
    return emitView();
  };

  const handlePlaybackStateChanged = Effect.fnUntraced(function* (message: PlaybackStateChanged) {
    if (
      state._tag === 'AwaitingRemoteStart' &&
      state.watchSessionId === message.watchSessionId &&
      state.started
    ) {
      memory.sampling.reset();
      yield* adoptWatcherCanonical(message);
      return yield* projectWatcherStream();
    }
    if (
      state._tag === 'AwaitingRecoverySnapshot' &&
      state.session.watchSessionId === message.watchSessionId &&
      message.authorityEpoch > state.session.authorityEpoch
    ) {
      return yield* adoptWatcherCanonical(message);
    }
    const watcher = watcherActiveSession();
    if (
      watcher !== null &&
      watcher.watchSessionId === message.watchSessionId &&
      (message.authorityEpoch > watcher.authorityEpoch ||
        (message.authorityEpoch === watcher.authorityEpoch && message.revision > watcher.revision))
    ) {
      yield* adoptWatcherCanonical(message);
    }
  });

  const armSampling = (session: PresenterWatchSession) => {
    if (memory.sampling.isArmed()) return Effect.void;
    memory.sampling.arm();
    return Effect.sleep(PROGRESS_SAMPLE_INTERVAL).pipe(
      Effect.andThen(
        Effect.sync(() =>
          dispatchInput({ _tag: 'ProgressSampleTick', watchSessionId: session.watchSessionId }),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
      Scope.provide(session.sourceScope),
    );
  };

  const armRestoreDeadline = (session: PresenterWatchSession) =>
    Effect.sleep(RESTORE_DEADLINE).pipe(
      Effect.andThen(
        Effect.sync(() =>
          dispatchInput({ _tag: 'RestoreDeadlineElapsed', watchSessionId: session.watchSessionId }),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
      Scope.provide(session.sourceScope),
    );

  // The single presenter commit path: bumps the revision, broadcasts, rearms
  // sampling when Playing.
  const commitPresenter = Effect.fnUntraced(function* (
    session: PresenterWatchSession,
    status: WatchStatus,
    progress: number,
    reason?: BufferingReason,
  ) {
    const next: PresenterWatchSession = { ...session, revision: session.revision + 1, progress };
    state = stateFromStatus(next, status, reason);
    yield* sendDiscrete(playbackState(next, status, reason));
    yield* emitView();
    if (state._tag === 'Playing') yield* armSampling(next);
  });

  const applyPresenterControl = Effect.fnUntraced(function* (
    session: PresenterWatchSession,
    control: WatchControlCommand,
    rejectOnInvalid: boolean,
  ) {
    const reject = rejectOnInvalid ? sendDiscrete(controlRejected(session)) : Effect.void;
    const apply = (
      operation: Effect.Effect<void, WatchPlatformError>,
      commit: Effect.Effect<void, unknown>,
    ) =>
      operation.pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.logWarning('Failed to apply watch control').pipe(
              Effect.annotateLogs({ control: control.kind, operation: error.operation }),
              Effect.andThen(reject),
            ),
          onSuccess: () => commit,
        }),
      );

    switch (control.kind) {
      case 'play':
        if (state._tag !== 'LoadedPaused') return yield* reject;
        return yield* apply(
          platform.play(session.source),
          commitPresenter(session, 'playing', session.progress),
        );
      case 'pause':
        if (state._tag !== 'Playing' && state._tag !== 'Buffering') return yield* reject;
        return yield* apply(
          platform.pause(session.source),
          commitPresenter(session, 'loaded-paused', session.progress),
        );
      case 'seek':
        if (state._tag === 'Buffering') return yield* reject;
        return yield* apply(
          platform.seek(session.source, control.target),
          commitPresenter(
            session,
            state._tag === 'Playing' ? 'playing' : 'loaded-paused',
            control.target,
          ),
        );
      case 'replay':
        if (state._tag !== 'Ended') return yield* reject;
        return yield* apply(
          Effect.gen(function* () {
            yield* platform.seek(session.source, 0);
            yield* platform.play(session.source);
          }),
          commitPresenter(session, 'playing', 0),
        );
      case 'eject':
        yield* sendDiscrete(watchEnded(session.watchSessionId));
        return yield* resetToIdle();
    }
  });

  const watcherOptimisticView = (
    session: WatcherWatchSession,
    control: WatchControlCommand,
  ): WatchSessionView | null => {
    const base = sessionView(session, 'loaded-paused', true, null);
    switch (control.kind) {
      case 'play':
        return { ...base, status: 'playing' };
      case 'pause':
        return { ...base, status: 'loaded-paused' };
      case 'seek':
        return { ...base, progress: control.target };
      case 'replay':
        return { ...base, status: 'playing', progress: 0 };
      case 'eject':
        return null;
    }
  };

  const handleRequestControl = Effect.fnUntraced(function* (control: WatchControlCommand) {
    const presenter = presenterActiveSession();
    if (presenter !== null) {
      return yield* applyPresenterControl(presenter, control, false);
    }
    const watcher = watcherActiveSession();
    if (watcher === null || watcher.interrupted) return;
    const optimistic = watcherOptimisticView(watcher, control);
    if (optimistic !== null) {
      yield* eventSink.emit({ _tag: 'WatchSessionChanged', view: optimistic });
    }
    yield* sendDiscrete(controlRequested(watcher, control));
  });

  const handleControlRequested = Effect.fnUntraced(function* (message: ControlRequested) {
    const presenter = presenterActiveSession();
    if (presenter === null || presenter.watchSessionId !== message.watchSessionId) return;
    if (
      message.authorityEpoch !== presenter.authorityEpoch ||
      message.baseRevision !== presenter.revision
    ) {
      return yield* sendDiscrete(controlRejected(presenter));
    }
    yield* applyPresenterControl(presenter, message.control, true);
  });

  const handleControlRejected = Effect.fnUntraced(function* (message: ControlRejected) {
    const watcher = watcherActiveSession();
    if (watcher === null || watcher.watchSessionId !== message.watchSessionId) return;
    yield* emitView();
  });

  const handleProgressSample = Effect.fnUntraced(function* (message: ProgressSample) {
    if (state._tag !== 'Playing') return;
    const watcher = watcherActiveSession();
    if (
      watcher === null ||
      watcher.watchSessionId !== message.watchSessionId ||
      message.authorityEpoch !== watcher.authorityEpoch ||
      message.revision !== watcher.revision ||
      !memory.sampling.acceptInbound(message.sequence)
    ) {
      return;
    }
    state = { _tag: 'Playing', session: { ...watcher, progress: message.progress } };
    yield* emitView();
  });

  const handleProgressSampleTick = Effect.fnUntraced(function* (watchSessionId: WatchSessionId) {
    memory.sampling.disarm();
    const session = presenterActiveSession();
    if (state._tag !== 'Playing' || session === null || session.watchSessionId !== watchSessionId) {
      return;
    }
    const progress = yield* platform.currentProgress(session.source);
    const next: PresenterWatchSession = { ...session, progress };
    state = { _tag: 'Playing', session: next };
    yield* offerLatestProgress(progressSample(next, memory.sampling.nextSequence()));
    yield* emitView();
    yield* armSampling(next);
  });

  const handleSourceBuffering = Effect.fnUntraced(function* () {
    const session = presenterActiveSession();
    if (session === null || state._tag !== 'Playing') return;
    yield* commitPresenter(session, 'buffering', session.progress, 'source');
  });

  const handleSourcePlaying = Effect.fnUntraced(function* () {
    const session = presenterActiveSession();
    if (session === null || state._tag !== 'Buffering' || state.reason !== 'source') return;
    yield* commitPresenter(session, 'playing', session.progress);
  });

  const handleSourceEnded = Effect.fnUntraced(function* () {
    const session = presenterActiveSession();
    if (session === null || (state._tag !== 'Playing' && state._tag !== 'Buffering')) return;
    yield* commitPresenter(session, 'ended', session.progress);
  });

  const handleSourceFailed = Effect.fnUntraced(function* () {
    const session = presenterActiveSession();
    if (session === null) return;
    yield* failActiveSession(session.watchSessionId, 'source');
  });

  const handleSourceProgress = Effect.fnUntraced(function* (progress: number) {
    const session = presenterActiveSession();
    if (session === null || state._tag !== 'Playing') return;
    state = { _tag: 'Playing', session: { ...session, progress } };
    yield* emitView();
  });

  const handleBackgroundThrottled = Effect.fnUntraced(function* () {
    const session = presenterActiveSession();
    if (session === null || state._tag !== 'Playing') return;
    yield* platform.pause(session.source);
    yield* commitPresenter(session, 'buffering', session.progress, 'background-throttled');
    yield* armRestoreDeadline(session);
  });

  const handleForegroundRestored = Effect.fnUntraced(function* () {
    const session = presenterActiveSession();
    if (session === null || state._tag !== 'Buffering' || state.reason !== 'background-throttled') {
      return;
    }
    yield* platform.play(session.source);
    yield* commitPresenter(session, 'playing', session.progress);
  });

  const handleRestoreDeadlineElapsed = Effect.fnUntraced(function* (
    watchSessionId: WatchSessionId,
  ) {
    const session = presenterActiveSession();
    if (
      session === null ||
      state._tag !== 'Buffering' ||
      state.reason !== 'background-throttled' ||
      session.watchSessionId !== watchSessionId
    ) {
      return;
    }
    yield* failActiveSession(session.watchSessionId, 'pipeline');
  });

  const handleTransportInterrupted = Effect.fnUntraced(function* () {
    const presenter = presenterActiveSession();
    if (presenter !== null) {
      memory.sampling.disarm();
      const next: PresenterWatchSession = {
        ...presenter,
        authorityEpoch: presenter.authorityEpoch + 1,
        interrupted: true,
      };
      if (state._tag === 'Playing' || state._tag === 'Buffering') {
        yield* platform.pause(presenter.source);
        state = { _tag: 'LoadedPaused', session: next };
      } else if (state._tag === 'Ended') {
        state = { _tag: 'Ended', session: next };
      } else {
        state = { _tag: 'LoadedPaused', session: next };
      }
      return yield* emitView();
    }
    const watcher = watcherActiveSession();
    if (watcher === null) return;
    memory.sampling.resetInbound();
    state = { _tag: 'AwaitingRecoverySnapshot', session: { ...watcher, interrupted: true } };
    yield* emitView();
  });

  const handleTransportRestored = Effect.fnUntraced(function* () {
    const presenter = presenterActiveSession();
    if (presenter === null || !presenter.interrupted) return;
    const restored: PresenterWatchSession = { ...presenter, interrupted: false };
    const status: WatchStatus = state._tag === 'Ended' ? 'ended' : 'loaded-paused';
    state =
      state._tag === 'Ended'
        ? { _tag: 'Ended', session: restored }
        : { _tag: 'LoadedPaused', session: restored };
    yield* sendDiscrete(playbackState(restored, status));
    yield* emitView();
  });

  const handleLocalPipelineFailed = Effect.fnUntraced(function* (reason: 'renderer' | 'pipeline') {
    const id = currentSessionId();
    if (id === null) return;
    const delivered = yield* transport
      .sendDiscrete({
        version: WATCH_PROTOCOL_VERSION,
        type: 'watch-failed',
        watchSessionId: id,
        reason,
      })
      .pipe(
        Effect.as(true),
        Effect.catchTag('WatchTransportError', () => Effect.succeed(false)),
      );
    yield* delivered ? resetToIdle(reason) : teardownUnavailable(reason);
  });

  const handleRemoteWatchFailed = Effect.fnUntraced(function* (message: WatchFailed) {
    if (currentSessionId() !== message.watchSessionId) return;
    yield* resetToIdle(message.reason);
  });

  const handleRemoteWatchEnded = Effect.fnUntraced(function* (message: WatchEnded) {
    if (activeWatcherSessionId() !== message.watchSessionId) return;
    yield* resetToIdle();
  });

  const handleRemoteProgramStreamChanged = Effect.fnUntraced(function* (
    stream: ProgramStreamHandle | null,
    version: number,
  ) {
    if (!memory.remoteProgram.accept(version, stream)) return;
    const baseline = memory.remoteProgram.baseline();
    if (baseline === null || version <= baseline || !isActiveWatcher()) return;
    yield* stream !== null
      ? eventSink.emit({ _tag: 'WatchProgramStreamReady', stream })
      : eventSink.emit({ _tag: 'WatchProgramStreamCleared' });
  });

  const handleRemoteMessage = Effect.fnUntraced(function* (message: WatchMessage) {
    switch (message.type) {
      case 'hello':
        return yield* handleHello(message);
      case 'watch-proposed':
        return yield* handleWatchProposed(message.watchSessionId);
      case 'watch-ready':
        return yield* handleWatchReady(message.watchSessionId);
      case 'watch-rejected':
        return yield* handleWatchRejected(message.watchSessionId);
      case 'watch-started':
        return yield* handleWatchStarted(message.watchSessionId);
      case 'playback-state-changed':
        return yield* handlePlaybackStateChanged(message);
      case 'watch-failed':
        return yield* handleRemoteWatchFailed(message);
      case 'watch-ended':
        return yield* handleRemoteWatchEnded(message);
      case 'control-requested':
        return yield* handleControlRequested(message);
      case 'control-rejected':
        return yield* handleControlRejected(message);
      case 'progress-sample':
        return yield* handleProgressSample(message);
    }
  });

  const handleInput = Effect.fnUntraced(function* (input: Parameters<WatchActorInputDispatch>[0]) {
    switch (input._tag) {
      case 'RemoteMessage':
        return yield* handleRemoteMessage(input.message);
      case 'ProposeLocalSource':
        return yield* handleProposeLocalSource(input.source);
      case 'CancelPreparing':
        return yield* handleCancelPreparing();
      case 'ChannelOpened':
        return yield* handleChannelOpened();
      case 'ChannelClosed':
        return yield* handleChannelClosed();
      case 'RemoteProgramStreamChanged':
        return yield* handleRemoteProgramStreamChanged(input.stream, input.version);
      case 'RequestControl':
        return yield* handleRequestControl(input.control);
      case 'SourceBuffering':
        return yield* handleSourceBuffering();
      case 'SourcePlaying':
        return yield* handleSourcePlaying();
      case 'SourceEnded':
        return yield* handleSourceEnded();
      case 'SourceFailed':
        return yield* handleSourceFailed();
      case 'SourceProgress':
        return yield* handleSourceProgress(input.progress);
      case 'BackgroundThrottled':
        return yield* handleBackgroundThrottled();
      case 'ForegroundRestored':
        return yield* handleForegroundRestored();
      case 'TransportInterrupted':
        return yield* handleTransportInterrupted();
      case 'TransportRestored':
        return yield* handleTransportRestored();
      case 'ProgressSampleTick':
        return yield* handleProgressSampleTick(input.watchSessionId);
      case 'RestoreDeadlineElapsed':
        return yield* handleRestoreDeadlineElapsed(input.watchSessionId);
      case 'LocalPipelineFailed':
        return yield* handleLocalPipelineFailed(input.reason);
    }
  });

  return { handleInput };
});

const blankView = (status: WatchSessionView['status'], canPresent: boolean): WatchSessionView => ({
  status,
  role: null,
  progress: 0,
  revision: 0,
  controlsEnabled: false,
  canPresent,
  bufferingReason: null,
});

const sessionView = (
  session: ActiveWatchSession,
  status: WatchSessionView['status'],
  controlsEnabled: boolean,
  bufferingReason: BufferingReason | null,
): WatchSessionView => ({
  status,
  role: session.role,
  progress: session.progress,
  revision: session.revision,
  controlsEnabled,
  canPresent: false,
  bufferingReason,
});

export { makeWatchActor };

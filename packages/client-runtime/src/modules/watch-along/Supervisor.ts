import { Cause, Crypto, Effect, Exit, Queue, Result, Scope } from 'effect';

import type { WatchActorInput } from './ActorModel';
import type { WatchCapabilities, WatchEvent, WatchSessionView } from './Model';
import { encodeWatchMessage, type ProgressSample, type WatchMessage } from './Protocol';
import {
  WatchAlongPlatform,
  type WatchPlatformError,
  WatchEventSink,
  WatchLocalCapabilities,
  WatchTransport,
  WatchTransportError,
} from './Services';
import { initialWatchSessionView } from './View';
import { makeWatchActor } from './WatchActor';

export const WATCH_PROGRESS_BUFFER_HIGH_WATER_BYTES = 64 * 1024;

export type WatchRuntimeTerminationReason = 'generation-closed' | 'actor-failed';

export interface WatchRuntime {
  readonly dispatch: (input: WatchActorInput) => boolean;
  readonly isAlive: () => boolean;
}

export interface StartWatchRuntimeDependencies {
  readonly role: 'host' | 'guest';
  readonly capabilities: WatchCapabilities;
  readonly sendRaw: (payload: string) => Effect.Effect<void, unknown>;
  readonly bufferedAmount: () => number;
  readonly closeWatchChannel: Effect.Effect<void, unknown>;
  readonly attach: (
    stream: Parameters<WatchAlongPlatform['Service']['attachProgramTracks']>[0],
  ) => Effect.Effect<void, WatchPlatformError>;
  readonly clear: Effect.Effect<void, WatchPlatformError>;
  readonly platform: WatchAlongPlatform['Service'];
  readonly sink: WatchEventSink['Service'];
  readonly onTerminated: (reason: WatchRuntimeTerminationReason) => Effect.Effect<void, unknown>;
}

interface WatchInputEnvelope {
  readonly input: WatchActorInput;
  readonly onDropped: Effect.Effect<void, unknown>;
}

const logCleanupFailure = (operation: string, cause: Cause.Cause<unknown>) =>
  Effect.logWarning('Watch supervisor cleanup failed').pipe(
    Effect.annotateLogs({ operation, cause: Cause.pretty(cause) }),
  );

const bestEffort = (operation: string, effect: Effect.Effect<void, unknown>) =>
  effect.pipe(Effect.catchCause((cause) => logCleanupFailure(operation, cause)));

/** Starts one watch actor whose lifetime is bounded by the current generation scope. */
export const startWatchRuntime = Effect.fn('@tether/client-runtime/startWatchRuntime')(function* (
  deps: StartWatchRuntimeDependencies,
) {
  const generationScope = yield* Scope.Scope;
  const crypto = yield* Crypto.Crypto;
  const actorScope = yield* Scope.fork(generationScope);
  const mailbox = yield* Queue.unbounded<WatchInputEnvelope>();

  let alive = true;
  let finalized = false;
  let pendingProgress: ProgressSample | null = null;
  let available = false;
  let programStreamProjected = false;
  let projectedView: WatchSessionView = initialWatchSessionView;

  const recordProjection = (event: WatchEvent) =>
    Effect.sync(() => {
      switch (event._tag) {
        case 'WatchAvailabilityChanged':
          available = event.available;
          return;
        case 'WatchSessionChanged':
          projectedView = event.view;
          return;
        case 'WatchProgramStreamReady':
          programStreamProjected = true;
          return;
        case 'WatchProgramStreamCleared':
          programStreamProjected = false;
          return;
        case 'WatchFailed':
          return;
      }
    });

  const supervisedSink = WatchEventSink.of({
    emit: (event) => deps.sink.emit(event).pipe(Effect.tap(() => recordProjection(event))),
  });

  const closeFailedTransport = (cause: unknown) =>
    bestEffort('close-watch-channel-after-send', deps.closeWatchChannel).pipe(
      Effect.andThen(Effect.fail(new WatchTransportError({ cause }))),
    );

  const failTransport = (cause: unknown) => Effect.fail(new WatchTransportError({ cause }));

  const sendMessage = Effect.fnUntraced(function* (
    message: WatchMessage,
    onFailure: (cause: unknown) => Effect.Effect<never, WatchTransportError>,
  ) {
    const encoded = encodeWatchMessage(message);
    // Actor-produced messages are schema-valid by construction; keep the
    // codec defense for future protocol families.
    /* v8 ignore next 3 */
    if (Result.isFailure(encoded)) {
      return yield* onFailure(encoded.failure);
    }
    yield* deps.sendRaw(encoded.success).pipe(Effect.catchCause(onFailure));
  });

  const readBufferedAmount = Effect.try({
    try: deps.bufferedAmount,
    /* v8 ignore next -- platform getters are synchronous numeric facts */
    catch: (cause) => new WatchTransportError({ cause }),
  });

  const flushLatestProgress = Effect.fnUntraced(function* () {
    if (pendingProgress === null) return;
    const amount = yield* readBufferedAmount;
    if (amount >= WATCH_PROGRESS_BUFFER_HIGH_WATER_BYTES) return;
    const message = pendingProgress;
    pendingProgress = null;
    // Progress is replaceable telemetry: retain it for a later flush without
    // closing an otherwise healthy channel when this send races a state blip.
    yield* sendMessage(message, failTransport).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          pendingProgress ??= message;
        }),
      ),
    );
  });

  const transport = WatchTransport.of({
    role: deps.role,
    sendDiscrete: Effect.fnUntraced(function* (message) {
      yield* sendMessage(message, closeFailedTransport);
      yield* flushLatestProgress();
    }),
    offerLatestProgress: Effect.fnUntraced(function* (message) {
      pendingProgress = message;
      yield* flushLatestProgress();
    }),
  });

  const platform = WatchAlongPlatform.of({
    ...deps.platform,
    attachProgramTracks: deps.attach,
    clearProgramTracks: deps.clear,
  });

  const dispatch = (input: WatchActorInput): boolean => {
    if (!alive) return false;
    const onDropped =
      input._tag === 'ProposeLocalSource'
        ? deps.platform.cancelPreparedSource(input.source)
        : Effect.void;
    return Queue.offerUnsafe(mailbox, { input, onDropped });
  };

  const actor = yield* makeWatchActor(dispatch).pipe(
    Effect.provideService(WatchAlongPlatform, platform),
    Effect.provideService(WatchTransport, transport),
    Effect.provideService(WatchLocalCapabilities, deps.capabilities),
    Effect.provideService(WatchEventSink, supervisedSink),
    Effect.provideService(Crypto.Crypto, crypto),
    Scope.provide(actorScope),
  );

  const resetProjection = Effect.fnUntraced(function* () {
    if (programStreamProjected) {
      yield* bestEffort(
        'clear-program-stream-projection',
        supervisedSink.emit({ _tag: 'WatchProgramStreamCleared' }),
      );
    }
    if (available) {
      yield* bestEffort(
        'clear-availability-projection',
        supervisedSink.emit({ _tag: 'WatchAvailabilityChanged', available: false }),
      );
    }
    if (projectedView !== initialWatchSessionView) {
      yield* bestEffort(
        'clear-view-projection',
        supervisedSink.emit({ _tag: 'WatchSessionChanged', view: initialWatchSessionView }),
      );
    }
  });

  const finalize = Effect.fnUntraced(function* (reason: WatchRuntimeTerminationReason) {
    const shouldFinalize = yield* Effect.sync(() => {
      /* v8 ignore next -- one actor loop owns the only finalizer invocation */
      if (finalized) return false;
      finalized = true;
      alive = false;
      return true;
    });
    /* v8 ignore next -- paired with the idempotency guard above */
    if (!shouldFinalize) return;

    const cleanup = Effect.gen(function* () {
      const queued = yield* Queue.clear(mailbox).pipe(
        /* v8 ignore next -- the private queue is only completed below */
        Effect.catchCause((cause) =>
          logCleanupFailure('drain-watch-mailbox', cause).pipe(Effect.as([])),
        ),
      );
      yield* Queue.shutdown(mailbox).pipe(
        /* v8 ignore next -- shutdown is infallible for this private queue */
        Effect.catchCause((cause) => logCleanupFailure('shutdown-watch-mailbox', cause)),
      );
      for (const envelope of queued) {
        yield* bestEffort('drop-queued-watch-input', envelope.onDropped);
      }

      yield* bestEffort('clear-program-tracks', deps.clear);
      yield* bestEffort('close-watch-actor-scope', Scope.close(actorScope, Exit.void));
      yield* resetProjection();
      if (reason === 'actor-failed') {
        yield* bestEffort(
          'emit-watch-failure',
          supervisedSink.emit({ _tag: 'WatchFailed', reason: 'pipeline' }),
        );
        yield* bestEffort('close-watch-channel', deps.closeWatchChannel);
      }
    }).pipe(
      Effect.ensuring(bestEffort('notify-watch-runtime-terminated', deps.onTerminated(reason))),
    );

    yield* Effect.uninterruptible(cleanup);
  });

  const actorLoop = Effect.forever(
    Queue.take(mailbox).pipe(
      Effect.flatMap((envelope) =>
        Effect.uninterruptible(
          Effect.sync(() => envelope.input).pipe(Effect.flatMap(actor.handleInput)),
        ),
      ),
    ),
  ).pipe(
    Effect.onExit((exit) =>
      finalize(
        Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
          ? 'actor-failed'
          : 'generation-closed',
      ),
    ),
  );

  yield* actorLoop.pipe(Effect.forkScoped({ startImmediately: true }));

  return { dispatch, isAlive: () => alive } satisfies WatchRuntime;
});

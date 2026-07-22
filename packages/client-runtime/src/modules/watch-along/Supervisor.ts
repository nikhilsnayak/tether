import { Cause, Crypto, Deferred, Effect, Exit, Fiber, Queue, Result, Scope } from 'effect';

import type { WatchActorInput } from './ActorModel';
import type { WatchCapabilities } from './Model';
import { encodeWatchMessage } from './Protocol';
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

export type WatchRuntimeShutdownReason = 'transport-interrupted' | 'overloaded';
export type WatchRuntimeTerminationReason =
  | 'generation-closed'
  | 'actor-failed'
  | WatchRuntimeShutdownReason;

export interface WatchRuntime {
  readonly dispatch: (input: WatchActorInput) => boolean;
  readonly isAlive: () => boolean;
  readonly shutdown: (reason: WatchRuntimeShutdownReason) => Effect.Effect<void>;
}

export interface StartWatchRuntimeDependencies {
  readonly role: 'host' | 'guest';
  readonly capabilities: WatchCapabilities;
  readonly sendRaw: (payload: string) => Effect.Effect<void, unknown>;
  readonly closeWatchChannel: Effect.Effect<void, unknown>;
  readonly attach: (
    stream: Parameters<WatchAlongPlatform['Service']['attachProgramTracks']>[0],
  ) => Effect.Effect<void, WatchPlatformError>;
  readonly clear: Effect.Effect<void, WatchPlatformError>;
  readonly platform: WatchAlongPlatform['Service'];
  readonly sink: WatchEventSink['Service'];
  readonly onTerminated: (reason: WatchRuntimeTerminationReason) => Effect.Effect<void, unknown>;
}

interface QueuedInput {
  readonly input: WatchActorInput;
  readonly onDropped: Effect.Effect<void, unknown>;
}

const WATCH_INPUT_QUEUE_CAPACITY = 64;

const bestEffort = (effect: Effect.Effect<void, unknown>) =>
  Effect.catchCause(effect, () => Effect.void);

/** Runs one serialized watch actor for the current peer-connection generation. */
export const startWatchRuntime = Effect.fnUntraced(function* (deps: StartWatchRuntimeDependencies) {
  const generationScope = yield* Scope.Scope;
  const crypto = yield* Crypto.Crypto;
  const actorScope = yield* Scope.fork(generationScope);
  const queue = yield* Queue.dropping<QueuedInput>(WATCH_INPUT_QUEUE_CAPACITY);
  const overload = Deferred.makeUnsafe<void>();
  let alive = true;
  let finalized = false;
  let requestedTermination: WatchRuntimeShutdownReason | null = null;

  const transport = WatchTransport.of({
    role: deps.role,
    sendDiscrete: (message) => {
      const encoded = encodeWatchMessage(message);
      if (Result.isFailure(encoded)) {
        return Effect.fail(new WatchTransportError({ cause: encoded.failure }));
      }
      return deps
        .sendRaw(encoded.success)
        .pipe(Effect.mapError((cause) => new WatchTransportError({ cause })));
    },
  });
  const platform = WatchAlongPlatform.of({
    ...deps.platform,
    attachProgramTracks: deps.attach,
    clearProgramTracks: deps.clear,
  });
  const dispatch = (input: WatchActorInput) => {
    if (!alive) return false;
    const accepted = Queue.offerUnsafe(queue, {
      input,
      onDropped:
        input._tag === 'ProposeLocalSource'
          ? deps.platform.cancelPreparedSource(input.source)
          : Effect.void,
    });
    if (accepted) return true;
    alive = false;
    requestedTermination = 'overloaded';
    Deferred.doneUnsafe(overload, Effect.void);
    return false;
  };

  const actor = yield* makeWatchActor(dispatch).pipe(
    Effect.provideService(WatchAlongPlatform, platform),
    Effect.provideService(WatchTransport, transport),
    Effect.provideService(WatchLocalCapabilities, deps.capabilities),
    Effect.provideService(WatchEventSink, deps.sink),
    Effect.provideService(Crypto.Crypto, crypto),
    Scope.provide(actorScope),
  );

  const finalize = Effect.fnUntraced(function* (reason: WatchRuntimeTerminationReason) {
    // Actor-loop exit is the sole caller; retain the guard so later finalizer
    // call sites cannot duplicate cleanup.
    /* v8 ignore next */
    if (finalized) return;
    finalized = true;
    alive = false;
    const queued = yield* Queue.clear(queue);
    yield* bestEffort(Queue.shutdown(queue));
    for (const item of queued) yield* bestEffort(item.onDropped);
    yield* bestEffort(deps.clear);
    yield* bestEffort(Scope.close(actorScope, Exit.void));
    yield* bestEffort(deps.sink.emit({ _tag: 'WatchProgramStreamCleared' }));
    yield* bestEffort(deps.sink.emit({ _tag: 'WatchAvailabilityChanged', available: false }));
    yield* bestEffort(
      deps.sink.emit({ _tag: 'WatchSessionChanged', view: initialWatchSessionView }),
    );
    if (reason === 'actor-failed') {
      yield* bestEffort(deps.sink.emit({ _tag: 'WatchFailed', reason: 'pipeline' }));
    }
    if (reason !== 'generation-closed') {
      yield* bestEffort(deps.closeWatchChannel);
    }
    yield* bestEffort(deps.onTerminated(reason));
  });

  const consumeInputs = Effect.forever(
    Queue.take(queue).pipe(Effect.flatMap((item) => actor.handleInput(item.input))),
  );
  const actorLoop = Effect.raceFirst(consumeInputs, Deferred.await(overload)).pipe(
    Effect.onExit((exit) =>
      finalize(
        requestedTermination ??
          (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
            ? 'actor-failed'
            : 'generation-closed'),
      ),
    ),
  );
  const actorFiber = yield* actorLoop.pipe(Effect.forkScoped({ startImmediately: true }));

  const shutdown = Effect.fnUntraced(function* (reason: WatchRuntimeShutdownReason) {
    if (!alive) {
      yield* Fiber.await(actorFiber);
      return;
    }
    alive = false;
    requestedTermination = reason;
    yield* Fiber.interrupt(actorFiber);
  });

  return { dispatch, isAlive: () => alive, shutdown } satisfies WatchRuntime;
});

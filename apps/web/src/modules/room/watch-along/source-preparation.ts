import type { PreparedSourceHandle } from '@tether/client-runtime/modules/watch-along';
import { Cause, Effect, Fiber } from 'effect';

export type SourcePreparationStatus = 'idle' | 'preparing';

export interface PreparedWatchSource {
  readonly source: PreparedSourceHandle;
  readonly cancel: () => Promise<void>;
}

export interface SourcePreparationRequest {
  readonly prepare: Effect.Effect<PreparedWatchSource, unknown>;
  readonly propose: (source: PreparedSourceHandle) => 'queued' | 'rejected';
  readonly onFailure: () => void;
  readonly onRejected: () => void;
}

export interface SourcePreparationOwner {
  readonly getSnapshot: () => SourcePreparationStatus;
  readonly subscribe: (listener: () => void) => () => void;
  readonly start: (request: SourcePreparationRequest) => void;
  readonly cancel: () => void;
}

export const createSourcePreparationOwner = (): SourcePreparationOwner => {
  const listeners = new Set<() => void>();
  let status: SourcePreparationStatus = 'idle';
  let generation = 0;
  let fiber: Fiber.Fiber<void, never> | null = null;

  const setStatus = (next: SourcePreparationStatus) => {
    if (status === next) return;
    status = next;
    for (const listener of listeners) listener();
  };

  const run = Effect.fnUntraced(
    function* (request: SourcePreparationRequest, requestGeneration: number) {
      const prepared = yield* request.prepare;
      let transferred = false;
      yield* Effect.sync(() => {
        if (generation !== requestGeneration) return;
        if (request.propose(prepared.source) === 'queued') {
          transferred = true;
        } else {
          request.onRejected();
        }
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() =>
            transferred ? Effect.void : Effect.promise(() => prepared.cancel()),
          ),
        ),
      );
    },
    (effect, request, requestGeneration) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            if (!Cause.hasInterruptsOnly(cause) && generation === requestGeneration) {
              request.onFailure();
            }
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (generation !== requestGeneration) return;
            fiber = null;
            setStatus('idle');
          }),
        ),
      ),
  );

  const interruptCurrent = () => {
    const current = fiber;
    if (current !== null) {
      Effect.runFork(Fiber.interrupt(current).pipe(Effect.asVoid));
    }
  };

  const cancel = () => {
    generation++;
    setStatus('idle');
    interruptCurrent();
  };

  return {
    getSnapshot: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) cancel();
      };
    },
    start: (request) => {
      const previous = fiber;
      const requestGeneration = ++generation;
      setStatus('preparing');
      fiber = Effect.runFork(
        (previous === null ? Effect.void : Fiber.interrupt(previous).pipe(Effect.asVoid)).pipe(
          Effect.andThen(run(request, requestGeneration)),
        ),
      );
    },
    cancel,
  };
};

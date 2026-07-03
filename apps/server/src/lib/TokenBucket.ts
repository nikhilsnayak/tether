import { Clock, Duration, Effect, Ref } from 'effect';

export interface TokenBucket {
  readonly tryTake: Effect.Effect<boolean>;
}

export const makeTokenBucket = Effect.fnUntraced(function* (options: {
  readonly capacity: number;
  readonly refillEvery: Duration.Input;
}) {
  const refillEveryMs = Duration.toMillis(Duration.fromInputUnsafe(options.refillEvery));

  if (
    !Number.isInteger(options.capacity) ||
    options.capacity < 1 ||
    !Number.isFinite(refillEveryMs) ||
    refillEveryMs <= 0
  ) {
    return yield* Effect.die(new Error('Invalid token bucket configuration'));
  }

  const now = yield* Clock.currentTimeMillis;
  const state = yield* Ref.make({ tokens: options.capacity, updatedAt: now });

  const tryTake = Clock.currentTimeMillis.pipe(
    Effect.flatMap((currentTime) =>
      Ref.modify(state, ({ tokens, updatedAt }) => {
        const elapsed = Math.max(0, currentTime - updatedAt);
        const available = Math.min(options.capacity, tokens + elapsed / refillEveryMs);

        if (available < 1) {
          return [false, { tokens: available, updatedAt: currentTime }];
        }

        return [true, { tokens: available - 1, updatedAt: currentTime }];
      }),
    ),
  );

  return { tryTake } satisfies TokenBucket;
});

import { assert, describe, it } from '@effect/vitest';
import { Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';

import { makeTokenBucket } from './TokenBucket';

describe('TokenBucket', () => {
  it.effect('rejects invalid configuration', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(makeTokenBucket({ capacity: 0, refillEvery: '1 second' }));

      assert.isTrue(Exit.isFailure(exit));
    }),
  );

  it.effect('allows the initial burst up to capacity', () =>
    Effect.gen(function* () {
      const bucket = yield* makeTokenBucket({ capacity: 2, refillEvery: '1 second' });

      assert.isTrue(yield* bucket.tryTake);
      assert.isTrue(yield* bucket.tryTake);
      assert.isFalse(yield* bucket.tryTake);
    }),
  );

  it.effect('refills one token at the configured interval', () =>
    Effect.gen(function* () {
      const bucket = yield* makeTokenBucket({ capacity: 1, refillEvery: '1 second' });

      assert.isTrue(yield* bucket.tryTake);
      yield* TestClock.adjust('999 millis');
      assert.isFalse(yield* bucket.tryTake);
      yield* TestClock.adjust('1 millis');
      assert.isTrue(yield* bucket.tryTake);
    }),
  );

  it.effect('never refills beyond capacity', () =>
    Effect.gen(function* () {
      const bucket = yield* makeTokenBucket({ capacity: 2, refillEvery: '1 second' });

      yield* bucket.tryTake;
      yield* TestClock.adjust('10 seconds');

      assert.isTrue(yield* bucket.tryTake);
      assert.isTrue(yield* bucket.tryTake);
      assert.isFalse(yield* bucket.tryTake);
    }),
  );

  it.effect('takes tokens atomically across concurrent fibers', () =>
    Effect.gen(function* () {
      const bucket = yield* makeTokenBucket({ capacity: 10, refillEvery: '1 second' });
      const results = yield* Effect.all(
        Array.from({ length: 100 }, () => bucket.tryTake),
        {
          concurrency: 'unbounded',
        },
      );

      assert.lengthOf(results.filter(Boolean), 10);
    }),
  );
});

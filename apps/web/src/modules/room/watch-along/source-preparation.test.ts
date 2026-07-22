import { assert, describe, it } from '@effect/vitest';
import type { PreparedSourceHandle } from '@tether/client-runtime/modules/watch-along';
import { Effect } from 'effect';
import { vi } from 'vitest';

import {
  createSourcePreparationOwner,
  type PreparedWatchSource,
  type SourcePreparationRequest,
} from './source-preparation';

const preparedSource = (id: string, cancel: () => void = () => {}): PreparedWatchSource => ({
  source: {
    _tag: 'PreparedSource',
    value: { id },
  } satisfies PreparedSourceHandle,
  cancel: async () => cancel(),
});

const request = (
  prepare: SourcePreparationRequest['prepare'],
  options: Partial<Omit<SourcePreparationRequest, 'prepare'>> = {},
): SourcePreparationRequest => ({
  prepare,
  propose: options.propose ?? (() => 'queued'),
  onFailure: options.onFailure ?? (() => {}),
  onRejected: options.onRejected ?? (() => {}),
});

describe('source preparation owner', () => {
  it('publishes status changes until unsubscribed', async () => {
    const owner = createSourcePreparationOwner();
    const statuses: string[] = [];
    const unsubscribe = owner.subscribe(() => statuses.push(owner.getSnapshot()));

    owner.start(request(Effect.succeed(preparedSource('observed'))));
    await vi.waitFor(() => assert.strictEqual(owner.getSnapshot(), 'idle'));
    assert.deepStrictEqual(statuses, ['preparing', 'idle']);

    unsubscribe();
    owner.start(request(Effect.succeed(preparedSource('unobserved'))));
    await vi.waitFor(() => assert.strictEqual(owner.getSnapshot(), 'idle'));
    assert.deepStrictEqual(statuses, ['preparing', 'idle']);
    owner.cancel();
  });

  it('transfers an accepted source without cancelling it', async () => {
    const owner = createSourcePreparationOwner();
    let cancelCount = 0;
    let proposedId: string | null = null;

    owner.start(
      request(Effect.succeed(preparedSource('accepted', () => cancelCount++)), {
        propose: (source) => {
          proposedId = (source.value as { id: string }).id;
          return 'queued';
        },
      }),
    );

    await vi.waitFor(() => assert.strictEqual(owner.getSnapshot(), 'idle'));
    assert.strictEqual(proposedId, 'accepted');
    assert.strictEqual(cancelCount, 0);
    owner.cancel();
  });

  it('releases a rejected source exactly once', async () => {
    const owner = createSourcePreparationOwner();
    let cancelCount = 0;
    let rejectedCount = 0;

    owner.start(
      request(Effect.succeed(preparedSource('rejected', () => cancelCount++)), {
        propose: () => 'rejected',
        onRejected: () => rejectedCount++,
      }),
    );

    await vi.waitFor(() => assert.strictEqual(owner.getSnapshot(), 'idle'));
    assert.strictEqual(cancelCount, 1);
    assert.strictEqual(rejectedCount, 1);
    owner.cancel();
    assert.strictEqual(cancelCount, 1);
  });

  it('interrupts the previous preparation before starting its replacement', async () => {
    const owner = createSourcePreparationOwner();
    let active = 0;
    let maximumActive = 0;
    let releaseCount = 0;
    const proposed: string[] = [];
    const first = Effect.sync(() => {
      active++;
      maximumActive = Math.max(maximumActive, active);
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          active--;
          releaseCount++;
        }),
      ),
    );

    owner.start(request(first));
    await vi.waitFor(() => assert.strictEqual(active, 1));
    owner.start(
      request(
        Effect.sync(() => {
          active++;
          maximumActive = Math.max(maximumActive, active);
          active--;
          return preparedSource('replacement');
        }),
        {
          propose: (source) => {
            proposed.push((source.value as { id: string }).id);
            return 'queued';
          },
        },
      ),
    );

    await vi.waitFor(() => assert.deepStrictEqual(proposed, ['replacement']));
    assert.strictEqual(releaseCount, 1);
    assert.strictEqual(maximumActive, 1);
    owner.cancel();
  });

  it('cancels an active preparation and returns to idle', async () => {
    const owner = createSourcePreparationOwner();
    let active = 0;
    let releaseCount = 0;
    let proposalCount = 0;
    const preparation = Effect.sync(() => active++).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          active--;
          releaseCount++;
        }),
      ),
    );

    owner.start(
      request(preparation, {
        propose: () => {
          proposalCount++;
          return 'queued';
        },
      }),
    );
    await vi.waitFor(() => assert.strictEqual(active, 1));

    owner.cancel();

    await vi.waitFor(() => assert.strictEqual(active, 0));
    assert.strictEqual(owner.getSnapshot(), 'idle');
    assert.strictEqual(releaseCount, 1);
    assert.strictEqual(proposalCount, 0);
    owner.cancel();
  });

  it('finishes cancellation before a new preparation starts', async () => {
    const owner = createSourcePreparationOwner();
    let active = 0;
    let maximumActive = 0;
    const proposed: string[] = [];
    const preparation = Effect.sync(() => {
      active++;
      maximumActive = Math.max(maximumActive, active);
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          active--;
        }),
      ),
    );

    owner.start(request(preparation));
    await vi.waitFor(() => assert.strictEqual(active, 1));
    owner.cancel();
    owner.start(
      request(
        Effect.sync(() => {
          active++;
          maximumActive = Math.max(maximumActive, active);
          active--;
          return preparedSource('after-cancel');
        }),
        {
          propose: (source) => {
            proposed.push((source.value as { id: string }).id);
            return 'queued';
          },
        },
      ),
    );

    await vi.waitFor(() => assert.deepStrictEqual(proposed, ['after-cancel']));
    assert.strictEqual(maximumActive, 1);
    owner.cancel();
  });

  it('cancels an active preparation when its final subscriber leaves', async () => {
    const owner = createSourcePreparationOwner();
    let active = 0;
    let releaseCount = 0;
    let proposalCount = 0;
    const unsubscribeFirst = owner.subscribe(() => {});
    const unsubscribeLast = owner.subscribe(() => {});
    const preparation = Effect.sync(() => active++).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          active--;
          releaseCount++;
        }),
      ),
    );

    owner.start(request(preparation));
    await vi.waitFor(() => assert.strictEqual(active, 1));
    unsubscribeFirst();
    assert.strictEqual(active, 1);
    unsubscribeLast();

    await vi.waitFor(() => assert.strictEqual(active, 0));
    const unsubscribeAgain = owner.subscribe(() => {});
    owner.start(
      request(Effect.succeed(preparedSource('late')), {
        propose: () => {
          proposalCount++;
          return 'queued';
        },
      }),
    );

    await vi.waitFor(() => assert.strictEqual(proposalCount, 1));
    assert.strictEqual(releaseCount, 1);
    unsubscribeAgain();
  });

  it('ignores completion after cancellation without reporting a failure', async () => {
    const owner = createSourcePreparationOwner();
    let resume: ((effect: Effect.Effect<PreparedWatchSource>) => void) | undefined;
    let proposalCount = 0;
    let failureCount = 0;
    const preparation = Effect.callback<PreparedWatchSource>((callback) => {
      resume = callback;
    });

    owner.start(
      request(preparation, {
        propose: () => {
          proposalCount++;
          return 'queued';
        },
        onFailure: () => failureCount++,
      }),
    );
    await vi.waitFor(() => assert.isDefined(resume));
    owner.cancel();
    resume?.(Effect.succeed(preparedSource('late')));

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(proposalCount, 0);
    assert.strictEqual(failureCount, 0);
    owner.cancel();
  });

  it('releases a source cancelled as preparation completes', async () => {
    const owner = createSourcePreparationOwner();
    let cancelCount = 0;
    let proposalCount = 0;

    owner.start(
      request(
        Effect.sync(() => {
          owner.cancel();
          return preparedSource('cancelled-completion', () => cancelCount++);
        }),
        {
          propose: () => {
            proposalCount++;
            return 'queued';
          },
        },
      ),
    );

    await vi.waitFor(() => assert.strictEqual(cancelCount, 1));
    assert.strictEqual(proposalCount, 0);
    assert.strictEqual(owner.getSnapshot(), 'idle');
    owner.cancel();
  });

  it('does not report a stale preparation failure', async () => {
    const owner = createSourcePreparationOwner();
    let failureCount = 0;

    owner.start(
      request(
        Effect.suspend(() => {
          owner.cancel();
          return Effect.fail('stale failure');
        }),
        { onFailure: () => failureCount++ },
      ),
    );

    await vi.waitFor(() => assert.strictEqual(owner.getSnapshot(), 'idle'));
    assert.strictEqual(failureCount, 0);
    owner.cancel();
  });

  it('reports preparation failures and returns to idle', async () => {
    const owner = createSourcePreparationOwner();
    let failureCount = 0;

    owner.start(
      request(Effect.fail('decode failed'), {
        onFailure: () => failureCount++,
      }),
    );

    await vi.waitFor(() => assert.strictEqual(failureCount, 1));
    assert.strictEqual(owner.getSnapshot(), 'idle');
    owner.cancel();
  });
});

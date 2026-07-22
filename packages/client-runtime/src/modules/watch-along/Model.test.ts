import { assert, describe, it } from '@effect/vitest';

import type { ClaimedSourceHandle, PreparedSourceHandle } from './Model';

describe('watch source handles', () => {
  it('keeps prepared and claimed capabilities distinct', () => {
    const prepared = {
      _tag: 'PreparedSource',
      value: null,
    } satisfies PreparedSourceHandle;

    // @ts-expect-error A prepared source must pass through claimSource first.
    const claimed: ClaimedSourceHandle = prepared;

    assert.strictEqual(claimed._tag, 'PreparedSource');
  });
});

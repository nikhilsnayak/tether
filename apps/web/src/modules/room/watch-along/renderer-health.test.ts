import { assert, describe, it } from 'vitest';

import { createWatchRendererHealth, type WatchRendererFailureSignal } from './renderer-health';

describe('watch renderer health', () => {
  it('fails an active session once and rearms for the next session', () => {
    const failures: WatchRendererFailureSignal[] = [];
    const health = createWatchRendererHealth((signal) => failures.push(signal));
    assert.isFalse(health.fail('video-error', false));
    assert.isTrue(health.fail('frame-draw', true));
    assert.isFalse(health.fail('video-error', true));
    assert.isFalse(health.fail('health-check', true));
    health.reset();
    assert.isTrue(health.fail('render-error', true));
    assert.deepStrictEqual(failures, ['frame-draw', 'render-error']);
  });
});

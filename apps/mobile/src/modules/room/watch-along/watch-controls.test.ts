import type { WatchSessionView } from '@tether/client-runtime/modules/watch-along';
import { assert, describe, it } from 'vitest';

import { clampSeekFraction, watchControlsForView } from './watch-controls';

const view = (overrides: Partial<WatchSessionView> = {}): WatchSessionView => ({
  status: 'idle',
  role: null,
  progress: 0,
  revision: 0,
  controlsEnabled: false,
  canPresent: false,
  bufferingReason: null,
  ...overrides,
});

describe('mobile watch controls', () => {
  it('clamps normalized seek input', () => {
    assert.strictEqual(clampSeekFraction(-0.2), 0);
    assert.strictEqual(clampSeekFraction(0.4), 0.4);
    assert.strictEqual(clampSeekFraction(1.2), 1);
  });

  it('maps inactive and loading states', () => {
    assert.deepInclude(watchControlsForView(view({ status: 'unavailable' }), false), {
      active: false,
      fullStage: false,
      feedback: 'Unavailable',
    });
    assert.strictEqual(watchControlsForView(view(), false).feedback, 'Waiting for presenter');
    assert.strictEqual(
      watchControlsForView(view({ status: 'preparing-local', role: 'presenter' }), false).feedback,
      'Preparing',
    );
    assert.strictEqual(
      watchControlsForView(view({ status: 'awaiting-remote-start', role: 'watcher' }), false)
        .feedback,
      'Loading',
    );
    assert.strictEqual(
      watchControlsForView(view({ status: 'awaiting-recovery-snapshot', role: 'watcher' }), false)
        .feedback,
      'Interrupted',
    );
  });

  it('maps playback controls and collapse independently from the session', () => {
    const paused = watchControlsForView(
      view({ status: 'loaded-paused', role: 'watcher', controlsEnabled: true }),
      false,
    );
    assert.deepInclude(paused, {
      active: true,
      fullStage: true,
      primary: { kind: 'play', enabled: true },
      seek: { visible: true, enabled: true },
      eject: { visible: true, enabled: true },
      feedback: 'Paused',
    });
    assert.isFalse(
      watchControlsForView(
        view({ status: 'loaded-paused', role: 'watcher', controlsEnabled: true }),
        true,
      ).fullStage,
    );

    const playing = watchControlsForView(
      view({ status: 'playing', role: 'watcher', controlsEnabled: true }),
      false,
    );
    assert.deepStrictEqual(playing.primary, { kind: 'pause', enabled: true });
    assert.strictEqual(playing.feedback, 'Playing');

    const buffering = watchControlsForView(
      view({ status: 'buffering', role: 'watcher', controlsEnabled: true }),
      false,
    );
    assert.deepStrictEqual(buffering.primary, { kind: 'pause', enabled: true });
    assert.deepStrictEqual(buffering.seek, { visible: true, enabled: false });
    assert.strictEqual(buffering.feedback, 'Buffering');
    assert.strictEqual(
      watchControlsForView(
        view({
          status: 'buffering',
          role: 'watcher',
          controlsEnabled: true,
          bufferingReason: 'background-throttled',
        }),
        false,
      ).feedback,
      'Waiting for presenter',
    );

    const ended = watchControlsForView(
      view({ status: 'ended', role: 'watcher', controlsEnabled: true }),
      false,
    );
    assert.deepStrictEqual(ended.primary, { kind: 'replay', enabled: true });
    assert.deepStrictEqual(ended.seek, { visible: true, enabled: false });
    assert.strictEqual(ended.feedback, 'Ended');
  });

  it('keeps eject available while readiness disables playback controls', () => {
    const controls = watchControlsForView(
      view({ status: 'loaded-paused', role: 'watcher', controlsEnabled: false }),
      false,
    );
    assert.isFalse(controls.primary.enabled);
    assert.isFalse(controls.seek.enabled);
    assert.deepStrictEqual(controls.eject, { visible: true, enabled: true });
  });
});

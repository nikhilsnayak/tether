import type { WatchSessionView, WatchViewStatus } from '@tether/client-runtime/modules/watch-along';
import { assert, describe, it } from 'vitest';

import { consoleControlsForView, seekFractionFromPointer } from './watch-console-model';

const view = (
  status: WatchViewStatus,
  overrides: Partial<WatchSessionView> = {},
): WatchSessionView => ({
  status,
  role: status === 'idle' || status === 'unavailable' ? null : 'watcher',
  progress: 0.5,
  revision: 1,
  controlsEnabled: true,
  canPresent: false,
  bufferingReason: null,
  ...overrides,
});

describe('watch console model', () => {
  it('clamps pointer positions and handles a degenerate track', () => {
    assert.strictEqual(seekFractionFromPointer(-2, 2), 0);
    assert.strictEqual(seekFractionFromPointer(0, 2), 0.5);
    assert.strictEqual(seekFractionFromPointer(2, 2), 1);
    assert.strictEqual(seekFractionFromPointer(1, 0), 0);
  });

  it('maps availability and setup states', () => {
    assert.strictEqual(consoleControlsForView(view('unavailable')).feedback, 'Unavailable');
    assert.deepStrictEqual(consoleControlsForView(view('idle', { canPresent: true })).select, {
      visible: true,
      enabled: true,
    });
    assert.strictEqual(consoleControlsForView(view('idle')).feedback, 'Waiting for presenter');
    assert.strictEqual(consoleControlsForView(view('preparing-local')).feedback, 'Preparing');
    assert.strictEqual(consoleControlsForView(view('awaiting-remote-start')).feedback, 'Loading');
    assert.strictEqual(
      consoleControlsForView(view('awaiting-recovery-snapshot')).feedback,
      'Interrupted',
    );
  });

  it('maps playback controls and never disables eject for an active session', () => {
    const paused = consoleControlsForView(view('loaded-paused'));
    assert.deepStrictEqual(paused.primary, { kind: 'play', enabled: true });
    assert.deepStrictEqual(paused.seek, { visible: true, enabled: true });
    assert.deepStrictEqual(paused.eject, { visible: true, enabled: true });
    assert.strictEqual(paused.feedback, 'Paused');

    const playing = consoleControlsForView(view('playing', { controlsEnabled: false }));
    assert.deepStrictEqual(playing.primary, { kind: 'pause', enabled: false });
    assert.isFalse(playing.seek.enabled);
    assert.isTrue(playing.eject.enabled);
    assert.strictEqual(playing.feedback, 'Playing');

    const buffering = consoleControlsForView(view('buffering'));
    assert.deepStrictEqual(buffering.primary, { kind: 'pause', enabled: true });
    assert.deepStrictEqual(buffering.seek, { visible: true, enabled: false });
    assert.strictEqual(buffering.feedback, 'Buffering');
    assert.strictEqual(
      consoleControlsForView(view('buffering', { bufferingReason: 'background-throttled' }))
        .feedback,
      'Waiting for presenter',
    );

    const ended = consoleControlsForView(view('ended'));
    assert.deepStrictEqual(ended.primary, { kind: 'replay', enabled: true });
    assert.isFalse(ended.seek.enabled);
    assert.strictEqual(ended.feedback, 'Ended');
  });
});

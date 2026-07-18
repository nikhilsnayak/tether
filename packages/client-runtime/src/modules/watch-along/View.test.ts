import { assert, describe, it } from 'vitest';

import type { WatchSessionView } from './Model';
import { initialWatchSessionView, reduceWatchView } from './View';

const playing: WatchSessionView = {
  status: 'playing',
  role: 'presenter',
  progress: 0.5,
  revision: 3,
  controlsEnabled: true,
  canPresent: false,
  bufferingReason: null,
};

describe('reduceWatchView', () => {
  it('starts unavailable', () => {
    assert.strictEqual(initialWatchSessionView.status, 'unavailable');
    assert.strictEqual(initialWatchSessionView.canPresent, false);
  });

  it('adopts the snapshot carried by a session change', () => {
    assert.deepStrictEqual(
      reduceWatchView(initialWatchSessionView, { _tag: 'WatchSessionChanged', view: playing }),
      playing,
    );
  });

  it('leaves the session view untouched for out-of-band events', () => {
    for (const event of [
      { _tag: 'WatchAvailabilityChanged', available: true },
      { _tag: 'WatchProgramStreamReady', stream: { value: {} } },
      { _tag: 'WatchProgramStreamCleared' },
      { _tag: 'WatchFailed', reason: 'source' },
    ] as const) {
      assert.strictEqual(reduceWatchView(playing, event), playing);
    }
  });
});

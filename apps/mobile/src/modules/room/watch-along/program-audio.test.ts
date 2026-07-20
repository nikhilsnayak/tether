import { assert, describe, it, vi } from 'vitest';

import { applyProgramAudioVolume, clampProgramVolume } from './program-audio';

describe('mobile program audio', () => {
  it('clamps local volume and restores tracks on cleanup', () => {
    const first = { _setVolume: vi.fn() };
    const second = { _setVolume: vi.fn() };
    const failure = vi.fn();
    const cleanup = applyProgramAudioVolume(
      { getAudioTracks: () => [first, second] },
      1.5,
      failure,
    );
    assert.deepStrictEqual(first._setVolume.mock.calls, [[1]]);
    assert.deepStrictEqual(second._setVolume.mock.calls, [[1]]);
    cleanup();
    assert.deepStrictEqual(first._setVolume.mock.calls, [[1], [1]]);
    assert.deepStrictEqual(second._setVolume.mock.calls, [[1], [1]]);
    assert.strictEqual(failure.mock.calls.length, 0);
    assert.strictEqual(clampProgramVolume(-1), 0);
    assert.strictEqual(clampProgramVolume(0.4), 0.4);
  });

  it('reports application and cleanup failures', () => {
    const applyFailure = vi.fn();
    const failedTrack = {
      _setVolume: () => {
        throw new Error('apply');
      },
    };
    applyProgramAudioVolume({ getAudioTracks: () => [failedTrack] }, 0.5, applyFailure)();
    assert.strictEqual(applyFailure.mock.calls.length, 1);

    let calls = 0;
    const cleanupFailure = vi.fn();
    const cleanup = applyProgramAudioVolume(
      {
        getAudioTracks: () => [
          {
            _setVolume: () => {
              calls += 1;
              if (calls === 2) throw new Error('cleanup');
            },
          },
        ],
      },
      0.5,
      cleanupFailure,
    );
    cleanup();
    assert.strictEqual(cleanupFailure.mock.calls.length, 1);
  });
});

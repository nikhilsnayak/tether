import { describe, expect, it } from 'vitest';

import { createSpatialAudioState } from './spatial-audio-state';

describe('createSpatialAudioState', () => {
  it('starts centered, facing +Z, with no remote present', () => {
    const state = createSpatialAudioState();
    expect(state.listener.position).toEqual({ x: 0, z: 0 });
    expect(state.listener.orientation).toEqual({ forwardX: 0, forwardZ: 1 });
    expect(state.remote.position).toEqual({ x: 0, z: 0 });
    expect(state.remote.present).toBe(false);
  });
});

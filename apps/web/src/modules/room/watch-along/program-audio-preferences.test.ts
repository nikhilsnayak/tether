import { assert, describe, it } from 'vitest';

import {
  createProgramAudioPreferencesStore,
  initialProgramAudioPreferences,
  normalizeProgramVolume,
} from './program-audio-preferences';

describe('program audio preferences', () => {
  it('normalizes finite volume into the local output range', () => {
    assert.strictEqual(normalizeProgramVolume(-1), 0);
    assert.strictEqual(normalizeProgramVolume(0.4), 0.4);
    assert.strictEqual(normalizeProgramVolume(2), 1);
    assert.strictEqual(normalizeProgramVolume(Number.NaN), 1);
  });

  it('publishes distinct normalized preferences and supports unsubscribe', () => {
    const store = createProgramAudioPreferencesStore({
      volume: 2,
      sinkId: 'speaker',
      speakerEnabled: true,
    });
    const observed: unknown[] = [];
    const unsubscribe = store.subscribe((preferences) => observed.push(preferences));

    assert.deepStrictEqual(store.get(), { volume: 1, sinkId: 'speaker', speakerEnabled: true });
    store.set({ volume: 1, sinkId: 'speaker', speakerEnabled: true });
    store.set({ volume: 0.25, sinkId: 'speaker', speakerEnabled: false });
    unsubscribe();
    store.set(initialProgramAudioPreferences);

    assert.deepStrictEqual(observed, [{ volume: 0.25, sinkId: 'speaker', speakerEnabled: false }]);
    assert.deepStrictEqual(store.get(), initialProgramAudioPreferences);
  });
});

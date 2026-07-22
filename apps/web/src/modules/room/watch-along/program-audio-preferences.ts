export interface ProgramAudioPreferences {
  readonly volume: number;
  readonly sinkId: string;
  readonly speakerEnabled: boolean;
}

export interface ProgramAudioPreferencesStore {
  readonly get: () => ProgramAudioPreferences;
  readonly set: (preferences: ProgramAudioPreferences) => void;
  readonly subscribe: (listener: (preferences: ProgramAudioPreferences) => void) => () => void;
}

export const initialProgramAudioPreferences: ProgramAudioPreferences = {
  volume: 1,
  sinkId: '',
  speakerEnabled: true,
};

export const normalizeProgramVolume = (volume: number): number =>
  Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;

export const createProgramAudioPreferencesStore = (
  initial: ProgramAudioPreferences = initialProgramAudioPreferences,
): ProgramAudioPreferencesStore => {
  let current = { ...initial, volume: normalizeProgramVolume(initial.volume) };
  const listeners = new Set<(preferences: ProgramAudioPreferences) => void>();

  return {
    get: () => current,
    set: (preferences) => {
      const next = { ...preferences, volume: normalizeProgramVolume(preferences.volume) };
      if (
        next.volume === current.volume &&
        next.sinkId === current.sinkId &&
        next.speakerEnabled === current.speakerEnabled
      ) {
        return;
      }
      current = next;
      for (const listener of listeners) listener(current);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const programAudioPreferences = createProgramAudioPreferencesStore();

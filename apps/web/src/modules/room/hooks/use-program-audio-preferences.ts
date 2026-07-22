import { useSyncExternalStore } from 'react';

import { programAudioPreferences } from '../watch-along/program-audio-preferences';

export function useProgramAudioPreferences() {
  const preferences = useSyncExternalStore(
    programAudioPreferences.subscribe,
    programAudioPreferences.get,
  );
  return { preferences, setPreferences: programAudioPreferences.set };
}

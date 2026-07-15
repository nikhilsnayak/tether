import { useSyncExternalStore } from 'react';

import { isQualityPreference, QUALITY_STORAGE_KEY, type QualityPreference } from '../scene/config';

const listeners = new Set<() => void>();

const publish = () => {
  const currentListeners = Array.from(listeners);
  for (const listener of currentListeners) listener();
};

const getSnapshot = (): QualityPreference => {
  const stored = localStorage.getItem(QUALITY_STORAGE_KEY);
  return isQualityPreference(stored) ? stored : 'auto';
};

const handleStorage = (event: StorageEvent) => {
  if (event.key === null || event.key === QUALITY_STORAGE_KEY) publish();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', handleStorage);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', handleStorage);
  };
};

const setQualityPreference = (preference: QualityPreference) => {
  if (preference === 'auto') localStorage.removeItem(QUALITY_STORAGE_KEY);
  else localStorage.setItem(QUALITY_STORAGE_KEY, preference);
  publish();
};

export function useRoomQualityPreference() {
  const qualityPreference = useSyncExternalStore(subscribe, getSnapshot);
  return { qualityPreference, setQualityPreference };
}

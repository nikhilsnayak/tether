import { useSyncExternalStore } from 'react';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(onStoreChange: () => void) {
  const media = matchMedia(reducedMotionQuery);
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

function reducedMotionPreference() {
  return matchMedia(reducedMotionQuery).matches;
}

export function useReducedMotionPreference() {
  return useSyncExternalStore(subscribeToReducedMotion, reducedMotionPreference, () => false);
}

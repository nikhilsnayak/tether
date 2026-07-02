import { useSyncExternalStore } from 'react';

function subscribeToViewportResize(onStoreChange: () => void) {
  window.addEventListener('resize', onStoreChange);
  window.visualViewport?.addEventListener('resize', onStoreChange);

  return () => {
    window.removeEventListener('resize', onStoreChange);
    window.visualViewport?.removeEventListener('resize', onStoreChange);
  };
}

function viewportAspectRatio() {
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;

  return height > 0 ? width / height : 1;
}

export function useViewportAspectRatio() {
  return useSyncExternalStore(subscribeToViewportResize, viewportAspectRatio, () => 1);
}

import { useSyncExternalStore } from 'react';

/**
 * Browser track state is enough to choose a local fallback, but it is not an authenticated signal
 * that the other person intentionally disabled their camera. Explicit camera state would require a
 * separate peer message.
 */
export function hasLiveRemoteVideo(stream: MediaStream | null): boolean {
  return (
    stream?.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted) ?? false
  );
}

export function useRemoteVideoAvailability(stream: MediaStream | null): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const tracks = stream?.getVideoTracks() ?? [];
      for (const track of tracks) {
        track.addEventListener('mute', onStoreChange);
        track.addEventListener('unmute', onStoreChange);
        track.addEventListener('ended', onStoreChange);
      }
      return () => {
        for (const track of tracks) {
          track.removeEventListener('mute', onStoreChange);
          track.removeEventListener('unmute', onStoreChange);
          track.removeEventListener('ended', onStoreChange);
        }
      };
    },
    () => hasLiveRemoteVideo(stream),
    () => false,
  );
}

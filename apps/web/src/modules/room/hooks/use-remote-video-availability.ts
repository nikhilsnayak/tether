import { useSyncExternalStore } from 'react';

/**
 * Reports whether the remote stream currently has renderable video pixels.
 * Intentional camera state arrives separately over the room-events channel;
 * callers combine that explicit state with this browser track observation.
 */
export function hasLiveRemoteVideo(stream: MediaStream | null): boolean {
  return (
    stream?.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted) ?? false
  );
}

export function useRemoteVideoAvailability(stream: MediaStream | null): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (stream === null) return () => {};

      const addTrackListeners = (track: MediaStreamTrack) => {
        track.addEventListener('mute', onStoreChange);
        track.addEventListener('unmute', onStoreChange);
        track.addEventListener('ended', onStoreChange);
      };
      const removeTrackListeners = (track: MediaStreamTrack) => {
        track.removeEventListener('mute', onStoreChange);
        track.removeEventListener('unmute', onStoreChange);
        track.removeEventListener('ended', onStoreChange);
      };

      for (const track of stream.getVideoTracks()) addTrackListeners(track);

      const onAddTrack = (event: MediaStreamTrackEvent) => {
        if (event.track.kind !== 'video') return;
        addTrackListeners(event.track);
        onStoreChange();
      };
      const onRemoveTrack = (event: MediaStreamTrackEvent) => {
        if (event.track.kind !== 'video') return;
        removeTrackListeners(event.track);
        onStoreChange();
      };

      stream.addEventListener('addtrack', onAddTrack);
      stream.addEventListener('removetrack', onRemoveTrack);

      return () => {
        stream.removeEventListener('addtrack', onAddTrack);
        stream.removeEventListener('removetrack', onRemoveTrack);
        for (const track of stream.getVideoTracks()) removeTrackListeners(track);
      };
    },
    () => hasLiveRemoteVideo(stream),
    () => false,
  );
}

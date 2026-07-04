import { useEffect } from 'react';
import type { MediaStream } from 'react-native-webrtc';

export function useRemoteAudioVolume(remoteStream: MediaStream | null, remoteAudioOn: boolean) {
  useEffect(() => {
    const audioTracks = remoteStream?.getAudioTracks() ?? [];
    for (const track of audioTracks) {
      track._setVolume(remoteAudioOn ? 1 : 0);
    }

    return () => {
      for (const track of audioTracks) {
        track._setVolume(1);
      }
    };
  }, [remoteAudioOn, remoteStream]);
}

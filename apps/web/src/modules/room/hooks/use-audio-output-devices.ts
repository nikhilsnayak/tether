import { useEffect, useState } from 'react';

const isAudioOutput = (device: MediaDeviceInfo) => device.kind === 'audiooutput';

export function useAudioOutputDevices(localStream: MediaStream | null) {
  const [audioOutputs, setAudioOutputs] = useState<readonly MediaDeviceInfo[]>([]);

  // Labels are only populated once mic permission is granted, so re-enumerate
  // when the local stream arrives and on any device hot-plug.
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices === undefined) return;

    let ignore = false;
    const refresh = async () => {
      try {
        const devices = await mediaDevices.enumerateDevices();
        if (ignore) return;
        setAudioOutputs(devices.filter(isAudioOutput));
      } catch {
        // Device enumeration is optional; retain the current output list when unavailable.
      }
    };

    void refresh();
    mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      ignore = true;
      mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [localStream]);

  return audioOutputs;
}

import { useEffect, useState } from 'react';

export function useAudioOutputDevices(localStream: MediaStream | null) {
  const [audioOutputs, setAudioOutputs] = useState<readonly MediaDeviceInfo[]>([]);

  // Labels are only populated once mic permission is granted, so re-enumerate
  // when the local stream arrives and on any device hot-plug.
  useEffect(() => {
    const refresh = () => {
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        setAudioOutputs(devices.filter((device) => device.kind === 'audiooutput'));
      });
    };

    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [localStream]);

  return audioOutputs;
}

import { useEffect, useState } from 'react';

const isAudioOutput = (device: MediaDeviceInfo) => device.kind === 'audiooutput';

export function useAudioOutputDevices(localStream: MediaStream | null) {
  const [audioOutputs, setAudioOutputs] = useState<readonly MediaDeviceInfo[]>([]);

  // Labels are only populated once mic permission is granted, so re-enumerate
  // when the local stream arrives and on any device hot-plug.
  useEffect(() => {
    const refresh = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioOutputs(devices.filter(isAudioOutput));
    };

    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [localStream]);

  return audioOutputs;
}

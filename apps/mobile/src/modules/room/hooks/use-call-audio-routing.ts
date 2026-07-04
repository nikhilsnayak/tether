import { useEffect, useState } from 'react';
import { DeviceEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { parseAudioDeviceStatus, type AudioRoute } from '../audio-output';

export function useCallAudioRouting() {
  const [availableAudioRoutes, setAvailableAudioRoutes] = useState<readonly AudioRoute[]>([
    'SPEAKER_PHONE',
    'EARPIECE',
  ]);
  const [selectedAudioRoute, setSelectedAudioRoute] = useState<AudioRoute>('SPEAKER_PHONE');

  const applyAudioDeviceStatus = (value: unknown) => {
    const status = parseAudioDeviceStatus(value);
    if (status === null) {
      return;
    }
    setAvailableAudioRoutes(status.available);
    if (status.selected !== null) {
      setSelectedAudioRoute(status.selected);
    }
  };

  useEffect(() => {
    let disposed = false;
    let inCallManagerStarted = false;
    const subscription = DeviceEventEmitter.addListener(
      'onAudioDeviceChanged',
      applyAudioDeviceStatus,
    );

    const startAudioRouting = async () => {
      if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
        try {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
        } catch {
          // Speaker, earpiece, and wired routes remain available without Bluetooth permission.
        }
      }

      if (disposed) {
        return;
      }

      try {
        InCallManager.start({ media: 'video' });
        inCallManagerStarted = true;
        const status = await InCallManager.chooseAudioRoute('SPEAKER_PHONE');
        if (!disposed) {
          applyAudioDeviceStatus(status);
        }
      } catch {
        // Calls remain usable with the platform's default audio route.
      }
    };

    void startAudioRouting();

    return () => {
      disposed = true;
      subscription.remove();
      if (inCallManagerStarted) {
        InCallManager.stop();
      }
    };
  }, []);

  const selectAudioRoute = async (route: AudioRoute) => {
    applyAudioDeviceStatus(await InCallManager.chooseAudioRoute(route));
  };

  return { availableAudioRoutes, selectedAudioRoute, selectAudioRoute };
}

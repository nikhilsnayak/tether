export const AUDIO_ROUTES = ['SPEAKER_PHONE', 'EARPIECE', 'WIRED_HEADSET', 'BLUETOOTH'] as const;

export type AudioRoute = (typeof AUDIO_ROUTES)[number];

export const AUDIO_ROUTE_LABEL: Record<AudioRoute, string> = {
  SPEAKER_PHONE: 'Speaker',
  EARPIECE: 'Earpiece',
  WIRED_HEADSET: 'Wired headset',
  BLUETOOTH: 'Bluetooth',
};

interface AudioDeviceStatus {
  readonly availableAudioDeviceList: string;
  readonly selectedAudioDevice: string;
}

const isAudioRoute = (value: unknown): value is AudioRoute =>
  typeof value === 'string' && AUDIO_ROUTES.some((route) => route === value);

export function parseAudioDeviceStatus(value: unknown): {
  readonly available: readonly AudioRoute[];
  readonly selected: AudioRoute | null;
} | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const status = value as Partial<AudioDeviceStatus>;
  if (
    typeof status.availableAudioDeviceList !== 'string' ||
    typeof status.selectedAudioDevice !== 'string'
  ) {
    return null;
  }

  try {
    const available = JSON.parse(status.availableAudioDeviceList) as unknown;
    if (!Array.isArray(available)) {
      return null;
    }

    return {
      available: AUDIO_ROUTES.filter((route) => available.includes(route)),
      selected: isAudioRoute(status.selectedAudioDevice) ? status.selectedAudioDevice : null,
    };
  } catch {
    return null;
  }
}

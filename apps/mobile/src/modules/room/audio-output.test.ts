import { describe, expect, it } from 'vitest';

import { parseAudioDeviceStatus } from './audio-output';

describe('parseAudioDeviceStatus', () => {
  it('returns supported routes in stable UI order', () => {
    expect(
      parseAudioDeviceStatus({
        availableAudioDeviceList: '["BLUETOOTH","SPEAKER_PHONE","UNKNOWN"]',
        selectedAudioDevice: 'BLUETOOTH',
      }),
    ).toEqual({
      available: ['SPEAKER_PHONE', 'BLUETOOTH'],
      selected: 'BLUETOOTH',
    });
  });

  it('keeps available routes when native selection is empty', () => {
    expect(
      parseAudioDeviceStatus({
        availableAudioDeviceList: '["SPEAKER_PHONE","EARPIECE"]',
        selectedAudioDevice: '',
      }),
    ).toEqual({
      available: ['SPEAKER_PHONE', 'EARPIECE'],
      selected: null,
    });
  });

  it.each([
    null,
    {},
    { availableAudioDeviceList: 'not-json', selectedAudioDevice: 'SPEAKER_PHONE' },
    { availableAudioDeviceList: '{}', selectedAudioDevice: 'SPEAKER_PHONE' },
  ])('rejects malformed native status %#', (status) => {
    expect(parseAudioDeviceStatus(status)).toBeNull();
  });
});

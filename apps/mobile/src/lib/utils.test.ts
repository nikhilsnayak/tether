import { assert, describe, it, vi } from 'vitest';

vi.mock('react-native-webrtc', () => ({
  MediaStream: class {},
  RTCPeerConnection: class {},
  mediaDevices: { getUserMedia: vi.fn() },
}));

vi.mock('expo-crypto', () => ({
  getRandomBytes: (size: number) => new Uint8Array(size).fill(1),
  digest: async () => new Uint8Array(),
}));

import { generatePeerId, generateRoomId } from './utils';

describe('native id generation', () => {
  it('generates a formatted room code', () => {
    assert.match(generateRoomId(), /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  });

  it('generates a 12-letter peer id', () => {
    assert.match(generatePeerId(), /^[a-z]{12}$/);
  });
});

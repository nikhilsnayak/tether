import { assert, describe, it } from 'vitest';

import { detectRoomCapabilities, type RoomCapabilityEnvironment } from './capabilities';

const supported: RoomCapabilityEnvironment = {
  isSecureContext: true,
  hasUserMedia: true,
  hasPeerConnection: true,
  hasWebGpu: true,
};

describe('room capabilities', () => {
  it('accepts a supported browser without requesting media', () => {
    assert.deepStrictEqual(detectRoomCapabilities(supported), { supported: true, missing: [] });
  });

  it('reports every missing capability', () => {
    assert.deepStrictEqual(
      detectRoomCapabilities({
        isSecureContext: false,
        hasUserMedia: false,
        hasPeerConnection: false,
        hasWebGpu: false,
      }),
      {
        supported: false,
        missing: ['secure-context', 'webgpu', 'user-media', 'peer-connection'],
      },
    );
  });
});

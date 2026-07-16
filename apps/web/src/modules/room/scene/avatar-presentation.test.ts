import { describe, expect, it } from 'vitest';

import { avatarPresentation } from './avatar-presentation';

describe('avatar presentation', () => {
  it.each([
    ['host', 'waiting', 'inside', 'absent'],
    ['join', 'outside', 'outside', 'absent'],
    ['host', 'connecting', 'inside', 'absent'],
    ['host', 'together', 'inside', 'present'],
    ['join', 'reconnecting', 'inside', 'reconnecting'],
    ['join', 'departed', 'inside', 'absent'],
    ['host', 'ended', 'inside', 'absent'],
    ['join', 'ended', 'outside', 'absent'],
  ] as const)('%s / %s places local %s and remote %s', (intent, journey, localLocation, remote) => {
    expect(avatarPresentation(intent, journey)).toEqual({
      local: 'present',
      localLocation,
      remote,
    });
  });
});

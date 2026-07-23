import { describe, expect, it } from 'vitest';

import { mobileWatchPresentation } from './presentation';

describe('mobileWatchPresentation', () => {
  it.each([
    ['awaiting-remote-start', null, 'Loading shared video'],
    ['loaded-paused', 'play', 'Shared video paused'],
    ['playing', 'pause', 'Watching together'],
    ['ended', 'replay', 'Shared video ended'],
  ] as const)('presents watcher status %s', (status, control, label) => {
    expect(mobileWatchPresentation({ status, role: 'watcher', canPresent: false })).toMatchObject({
      active: true,
      control,
      label,
    });
  });

  it('stays inactive when no remote watch session owns playback', () => {
    expect(
      mobileWatchPresentation({ status: 'idle', role: null, canPresent: false }),
    ).toMatchObject({
      active: false,
      control: null,
    });
  });

  it.each(['unavailable', 'idle', 'preparing-local'] as const)(
    'stays inactive for watcher status %s',
    (status) => {
      expect(mobileWatchPresentation({ status, role: 'watcher', canPresent: false })).toMatchObject(
        {
          active: false,
          control: null,
        },
      );
    },
  );
});

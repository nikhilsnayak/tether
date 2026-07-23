import type { WatchSessionView } from '@tether/client-runtime/modules/watch-along';

export interface MobileWatchPresentation {
  readonly active: boolean;
  readonly label: string;
  readonly hint: string;
  readonly control: 'play' | 'pause' | 'replay' | null;
}

export const mobileWatchPresentation = (view: WatchSessionView): MobileWatchPresentation => {
  if (view.role !== 'watcher') {
    return {
      active: false,
      label: 'Watch Together',
      hint: 'Waiting for a shared video.',
      control: null,
    };
  }

  switch (view.status) {
    case 'awaiting-remote-start':
      return {
        active: true,
        label: 'Loading shared video',
        hint: 'The other person is preparing playback.',
        control: null,
      };
    case 'loaded-paused':
      return {
        active: true,
        label: 'Shared video paused',
        hint: 'Playback controls affect both people.',
        control: 'play',
      };
    case 'playing':
      return {
        active: true,
        label: 'Watching together',
        hint: 'Playing directly from the other person.',
        control: 'pause',
      };
    case 'ended':
      return {
        active: true,
        label: 'Shared video ended',
        hint: 'Replay it for both people or stop watching.',
        control: 'replay',
      };
    case 'unavailable':
    case 'idle':
    case 'preparing-local':
      return {
        active: false,
        label: 'Watch Together',
        hint: 'Waiting for a shared video.',
        control: null,
      };
  }
};

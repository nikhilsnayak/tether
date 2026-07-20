import type { WatchSessionView } from '@tether/client-runtime/modules/watch-along';

export type MobilePrimaryControl = 'play' | 'pause' | 'replay' | null;

export interface MobileWatchControls {
  readonly active: boolean;
  readonly fullStage: boolean;
  readonly primary: { readonly kind: MobilePrimaryControl; readonly enabled: boolean };
  readonly seek: { readonly visible: boolean; readonly enabled: boolean };
  readonly eject: { readonly visible: boolean; readonly enabled: boolean };
  readonly feedback: string;
}

export const clampSeekFraction = (value: number): number => Math.min(1, Math.max(0, value));

const feedbackForView = (view: WatchSessionView): string => {
  switch (view.status) {
    case 'unavailable':
      return 'Unavailable';
    case 'idle':
      return 'Waiting for presenter';
    case 'preparing-local':
      return 'Preparing';
    case 'awaiting-remote-start':
      return 'Loading';
    case 'loaded-paused':
      return 'Paused';
    case 'playing':
      return 'Playing';
    case 'buffering':
      return view.bufferingReason === 'background-throttled'
        ? 'Waiting for presenter'
        : 'Buffering';
    case 'ended':
      return 'Ended';
    case 'awaiting-recovery-snapshot':
      return 'Interrupted';
  }
};

export const watchControlsForView = (
  view: WatchSessionView,
  collapsed: boolean,
): MobileWatchControls => {
  const active = view.role !== null;
  const seekVisible =
    view.status === 'loaded-paused' ||
    view.status === 'playing' ||
    view.status === 'buffering' ||
    view.status === 'ended';
  const primary: MobilePrimaryControl =
    view.status === 'loaded-paused'
      ? 'play'
      : view.status === 'playing' || view.status === 'buffering'
        ? 'pause'
        : view.status === 'ended'
          ? 'replay'
          : null;

  return {
    active,
    fullStage: active && !collapsed,
    primary: { kind: primary, enabled: primary !== null && view.controlsEnabled },
    seek: {
      visible: seekVisible,
      enabled:
        seekVisible &&
        view.controlsEnabled &&
        view.status !== 'buffering' &&
        view.status !== 'ended',
    },
    eject: { visible: active, enabled: active },
    feedback: feedbackForView(view),
  };
};

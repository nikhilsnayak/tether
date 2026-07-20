import type { WatchSessionView } from '@tether/client-runtime/modules/watch-along';

export type ConsolePrimaryControl = 'play' | 'pause' | 'replay' | null;

export interface ConsoleControls {
  readonly select: { readonly visible: boolean; readonly enabled: boolean };
  readonly primary: { readonly kind: ConsolePrimaryControl; readonly enabled: boolean };
  readonly seek: { readonly visible: boolean; readonly enabled: boolean };
  readonly eject: { readonly visible: boolean; readonly enabled: boolean };
  readonly feedback: string;
}

export const seekFractionFromPointer = (localX: number, trackWidth: number): number =>
  trackWidth <= 0 ? 0 : Math.min(1, Math.max(0, localX / trackWidth + 0.5));

const consoleFeedback = (view: WatchSessionView): string => {
  switch (view.status) {
    case 'unavailable':
      return 'Unavailable';
    case 'idle':
      return view.canPresent ? 'Select a video' : 'Waiting for presenter';
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

export const consoleControlsForView = (view: WatchSessionView): ConsoleControls => {
  const sessionActive = view.role !== null;
  const seekVisible =
    view.status === 'loaded-paused' ||
    view.status === 'playing' ||
    view.status === 'buffering' ||
    view.status === 'ended';
  const primary: ConsolePrimaryControl =
    view.status === 'loaded-paused'
      ? 'play'
      : view.status === 'playing' || view.status === 'buffering'
        ? 'pause'
        : view.status === 'ended'
          ? 'replay'
          : null;

  return {
    select: {
      visible: view.status === 'idle' && view.canPresent,
      enabled: view.status === 'idle' && view.canPresent,
    },
    primary: { kind: primary, enabled: primary !== null && view.controlsEnabled },
    seek: {
      visible: seekVisible,
      enabled:
        seekVisible &&
        view.controlsEnabled &&
        view.status !== 'buffering' &&
        view.status !== 'ended',
    },
    eject: { visible: sessionActive, enabled: sessionActive },
    feedback: consoleFeedback(view),
  };
};

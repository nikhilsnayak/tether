export type WatchRendererFailureSignal =
  | 'context-lost'
  | 'device-lost'
  | 'video-error'
  | 'frame-draw'
  | 'render-error'
  | 'health-check';

export interface WatchRendererHealth {
  readonly reset: () => void;
  readonly fail: (signal: WatchRendererFailureSignal, active: boolean) => boolean;
}

export const createWatchRendererHealth = (
  onFailure: (signal: WatchRendererFailureSignal) => void,
): WatchRendererHealth => {
  let failed = false;

  return {
    reset: () => {
      failed = false;
    },
    fail: (signal, active) => {
      if (!active || failed) return false;
      failed = true;
      onFailure(signal);
      return true;
    },
  };
};

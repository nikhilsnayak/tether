import type { WatchCapabilities } from '@tether/client-runtime/modules/watch-along';
import { Effect } from 'effect';

export const detectPresentationCapability = (): Effect.Effect<boolean> =>
  Effect.sync(() => {
    const video = document.createElement('video') as HTMLVideoElement & {
      readonly captureStream?: unknown;
    };
    return typeof video.captureStream === 'function';
  });

export const detectWatchCapabilities = Effect.suspend(() =>
  Effect.map(
    detectPresentationCapability(),
    (canPresentLocalFile): WatchCapabilities => ({
      canPresentLocalFile,
      canReceiveProgramMedia: true,
      canRenderWatch: true,
      canControlWatch: true,
    }),
  ),
);

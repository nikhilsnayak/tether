import {
  WatchAlongPlatform,
  WatchLocalCapabilities,
  WatchPlatformError,
  type WatchPlatformOperation,
} from '@tether/client-runtime/modules/watch-along';
import { Effect, Layer } from 'effect';

const cannotPresent = (operation: WatchPlatformOperation) =>
  Effect.fail(new WatchPlatformError({ operation, cause: 'mobile-cannot-present' }));

export const mobileWatchAlongPlatform = WatchAlongPlatform.of({
  cancelPreparedSource: () => cannotPresent('cancel-prepared-source'),
  claimSource: () => cannotPresent('claim-source'),
  programStream: () => cannotPresent('program-stream'),
  play: () => cannotPresent('play'),
  pause: () => cannotPresent('pause'),
  seek: () => cannotPresent('seek'),
  currentProgress: () => cannotPresent('current-progress'),
  observeSource: () => cannotPresent('observe-source'),
  primeFirstFrame: () => cannotPresent('prime-first-frame'),
  // Peer-session supervision replaces these with the generation-scoped
  // program-transceiver operations before starting a watch actor.
  attachProgramTracks: () => Effect.void,
  clearProgramTracks: Effect.void,
});

export const mobileWatchCapabilities = {
  canPresentLocalFile: false,
  canReceiveProgramMedia: true,
  canRenderWatch: true,
  canControlWatch: true,
} as const;

export const mobileWatchAlongPlatformLayer = Layer.succeed(
  WatchAlongPlatform,
  mobileWatchAlongPlatform,
);

export const mobileWatchLocalCapabilitiesLayer = Layer.succeed(
  WatchLocalCapabilities,
  mobileWatchCapabilities,
);

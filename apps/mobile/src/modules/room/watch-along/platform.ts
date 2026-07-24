import {
  WatchAlongPlatform,
  WatchLocalCapabilities,
  WatchPlatformError,
  type ProgramStreamHandle,
  type WatchPlatformOperation,
} from '@tether/client-runtime/modules/watch-along';
import { Effect, Layer } from 'effect';
import type { MediaStream } from 'react-native-webrtc';

export const programMediaStreamValue = (handle: ProgramStreamHandle) => handle.value as MediaStream;

const unsupportedPresentationOperation = (operation: WatchPlatformOperation) =>
  Effect.fail(
    new WatchPlatformError({
      operation,
      cause: 'Mobile supports Watch Together reception only',
    }),
  );

export const mobileWatchAlongPlatform = WatchAlongPlatform.of({
  cancelPreparedSource: () => unsupportedPresentationOperation('cancel-prepared-source'),
  claimSource: () => unsupportedPresentationOperation('claim-source'),
  programStream: () => unsupportedPresentationOperation('program-stream'),
  play: () => unsupportedPresentationOperation('play'),
  pause: () => unsupportedPresentationOperation('pause'),
  replay: () => unsupportedPresentationOperation('replay'),
  observeSource: () => unsupportedPresentationOperation('observe-source'),
  primeFirstFrame: () => unsupportedPresentationOperation('prime-first-frame'),
  sourceMediaInfo: () => unsupportedPresentationOperation('source-media-info'),
  readSourceBytes: () => unsupportedPresentationOperation('read-source-bytes'),
  // Peer-session supervision replaces these two operations with the reserved
  // program-transceiver implementation before the watch actor starts.
  attachProgramTracks: () => unsupportedPresentationOperation('attach-program-tracks'),
  clearProgramTracks: unsupportedPresentationOperation('clear-program-tracks'),
});

export const mobileWatchAlongPlatformLayer = Layer.succeed(
  WatchAlongPlatform,
  mobileWatchAlongPlatform,
);

export const mobileWatchLocalCapabilitiesLayer = Layer.succeed(WatchLocalCapabilities, {
  canPresentLocalFile: false,
  canReceiveProgramMedia: true,
  canRenderWatch: true,
  canControlWatch: true,
});

import {
  WatchAlongPlatform,
  WatchLocalCapabilities,
  WatchPlatformError,
  type ClaimedSourceHandle,
  type PreparedSourceHandle,
  type ProgramStreamHandle,
  type WatchPlatformOperation,
} from '@tether/client-runtime/modules/watch-along';
import { Effect, Layer } from 'effect';

import { detectWatchCapabilities } from './capability';
import {
  programStreamHandle,
  webWatchSourceResource,
  type WebWatchSourceResource,
} from './source-adapter';

export const programMediaStreamValue = (handle: ProgramStreamHandle) => handle.value as MediaStream;

const invalidSource = (operation: WatchPlatformOperation) =>
  new WatchPlatformError({ operation, cause: 'Invalid web watch source handle' });

const mapSourceError = (operation: WatchPlatformOperation, cause: unknown) =>
  new WatchPlatformError({ operation, cause });

const preparedResource = (
  operation: WatchPlatformOperation,
  source: PreparedSourceHandle,
): Effect.Effect<WebWatchSourceResource, WatchPlatformError> => {
  const resource = webWatchSourceResource(source);
  return resource === null ? Effect.fail(invalidSource(operation)) : Effect.succeed(resource);
};

const claimedResource = (
  operation: WatchPlatformOperation,
  source: ClaimedSourceHandle,
): Effect.Effect<WebWatchSourceResource, WatchPlatformError> => {
  const resource = webWatchSourceResource(source);
  return resource === null ? Effect.fail(invalidSource(operation)) : Effect.succeed(resource);
};

export const webWatchAlongPlatform = WatchAlongPlatform.of({
  cancelPreparedSource: (source) =>
    preparedResource('cancel-prepared-source', source).pipe(
      Effect.flatMap((resource) => resource.cancel),
    ),
  claimSource: (source) =>
    preparedResource('claim-source', source).pipe(
      Effect.flatMap((resource) => resource.claim),
      Effect.mapError((cause) => mapSourceError('claim-source', cause)),
    ),
  programStream: (source) =>
    claimedResource('program-stream', source).pipe(Effect.map(programStreamHandle)),
  play: (source) =>
    claimedResource('play', source).pipe(
      Effect.flatMap((resource) => resource.play),
      Effect.mapError((cause) => mapSourceError('play', cause)),
    ),
  pause: (source) =>
    claimedResource('pause', source).pipe(
      Effect.flatMap((resource) => resource.pause),
      Effect.mapError((cause) => mapSourceError('pause', cause)),
    ),
  replay: (source) =>
    claimedResource('replay', source).pipe(
      Effect.flatMap((resource) => resource.replay),
      Effect.mapError((cause) => mapSourceError('replay', cause)),
    ),
  observeSource: (source, dispatch) =>
    claimedResource('observe-source', source).pipe(
      Effect.flatMap((resource) => resource.observe(dispatch)),
      Effect.mapError((cause) => mapSourceError('observe-source', cause)),
    ),
  primeFirstFrame: (source) =>
    claimedResource('prime-first-frame', source).pipe(
      Effect.flatMap((resource) => resource.primeFirstFrame),
      Effect.mapError((cause) => mapSourceError('prime-first-frame', cause)),
    ),
  attachProgramTracks: () => Effect.fail(invalidSource('attach-program-tracks')),
  clearProgramTracks: Effect.fail(invalidSource('clear-program-tracks')),
});

export const webWatchAlongPlatformLayer = Layer.succeed(WatchAlongPlatform, webWatchAlongPlatform);

export const webWatchLocalCapabilitiesLayer = Layer.effect(
  WatchLocalCapabilities,
  detectWatchCapabilities,
);

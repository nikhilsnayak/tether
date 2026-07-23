import { it } from '@effect/vitest';
import {
  WatchAlongPlatform,
  WatchLocalCapabilities,
  type ClaimedSourceHandle,
  type PreparedSourceHandle,
  type ProgramStreamHandle,
} from '@tether/client-runtime/modules/watch-along';
import { Effect } from 'effect';
import { describe, expect } from 'vitest';

import {
  mobileWatchAlongPlatformLayer,
  mobileWatchLocalCapabilitiesLayer,
  programMediaStreamValue,
} from './platform';

describe('mobile Watch Together platform', () => {
  it('unwraps the native program stream', () => {
    const stream = {};

    expect(programMediaStreamValue({ value: stream })).toBe(stream);
  });

  it.effect('advertises receive-only playback and control capabilities', () =>
    Effect.gen(function* () {
      const capabilities = yield* WatchLocalCapabilities;

      expect(capabilities).toEqual({
        canPresentLocalFile: false,
        canReceiveProgramMedia: true,
        canRenderWatch: true,
        canControlWatch: true,
      });
    }).pipe(Effect.provide(mobileWatchLocalCapabilitiesLayer)),
  );

  it.effect('rejects local presentation operations', () =>
    Effect.gen(function* () {
      const platform = yield* WatchAlongPlatform;
      const source: PreparedSourceHandle = { _tag: 'PreparedSource', value: {} };
      const claimedSource: ClaimedSourceHandle = { _tag: 'ClaimedSource', value: {} };
      const programStream: ProgramStreamHandle = { value: {} };
      const operations = yield* Effect.all(
        [
          platform.cancelPreparedSource(source),
          platform.claimSource(source),
          platform.programStream(claimedSource),
          platform.play(claimedSource),
          platform.pause(claimedSource),
          platform.replay(claimedSource),
          platform.observeSource(claimedSource, () => undefined),
          platform.primeFirstFrame(claimedSource),
          platform.attachProgramTracks(programStream),
          platform.clearProgramTracks,
        ].map((operation) =>
          operation.pipe(
            Effect.flip,
            Effect.map((error) => error.operation),
          ),
        ),
      );

      expect(operations).toEqual([
        'cancel-prepared-source',
        'claim-source',
        'program-stream',
        'play',
        'pause',
        'replay',
        'observe-source',
        'prime-first-frame',
        'attach-program-tracks',
        'clear-program-tracks',
      ]);
    }).pipe(Effect.provide(mobileWatchAlongPlatformLayer)),
  );
});

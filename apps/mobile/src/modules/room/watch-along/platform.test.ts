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

  it.effect('rejects every local presentation operation', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* WatchAlongPlatform;
        const prepared: PreparedSourceHandle = { _tag: 'PreparedSource', value: {} };
        const claimed: ClaimedSourceHandle = { _tag: 'ClaimedSource', value: {} };
        const stream: ProgramStreamHandle = { value: {} };
        const errors = yield* Effect.all([
          platform.cancelPreparedSource(prepared).pipe(Effect.flip),
          platform.claimSource(prepared).pipe(Effect.flip),
          platform.programStream(claimed).pipe(Effect.flip),
          platform.play(claimed).pipe(Effect.flip),
          platform.pause(claimed).pipe(Effect.flip),
          platform.replay(claimed).pipe(Effect.flip),
          platform.observeSource(claimed, () => undefined).pipe(Effect.flip),
          platform.primeFirstFrame(claimed).pipe(Effect.flip),
          platform.attachProgramTracks(stream).pipe(Effect.flip),
          platform.clearProgramTracks.pipe(Effect.flip),
        ]);

        expect(errors.map((error) => error.operation)).toEqual([
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
      }),
    ).pipe(Effect.provide(mobileWatchAlongPlatformLayer)),
  );

  it('unwraps the native program media stream', () => {
    const stream = { id: 'program' };
    expect(programMediaStreamValue({ value: stream })).toBe(stream);
  });
});

import { it } from '@effect/vitest';
import {
  WatchAlongPlatform,
  WatchLocalCapabilities,
  type PreparedSourceHandle,
} from '@tether/client-runtime/modules/watch-along';
import { Effect } from 'effect';
import { describe, expect } from 'vitest';

import { mobileWatchAlongPlatformLayer, mobileWatchLocalCapabilitiesLayer } from './platform';

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

  it.effect('rejects local presentation operations', () =>
    Effect.gen(function* () {
      const platform = yield* WatchAlongPlatform;
      const source: PreparedSourceHandle = { _tag: 'PreparedSource', value: {} };
      const error = yield* platform.claimSource(source).pipe(Effect.flip);

      expect(error.operation).toBe('claim-source');
    }).pipe(Effect.provide(mobileWatchAlongPlatformLayer)),
  );
});

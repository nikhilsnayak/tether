import { assert, describe, it } from '@effect/vitest';
import { WatchLocalCapabilities } from '@tether/client-runtime/modules/watch-along';
import { Effect } from 'effect';
import { afterEach, vi } from 'vitest';

import { detectPresentationCapability } from './capability';
import { webWatchLocalCapabilitiesLayer } from './platform';
import { FakeWatchVideo } from './test/WatchSourceTestHarness';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('watch presentation capability', () => {
  it.effect('detects any browser exposing captureStream without checking browser identity', () => {
    const video = new FakeWatchVideo();
    vi.stubGlobal('document', { createElement: () => video });
    return Effect.gen(function* () {
      assert.isTrue(yield* detectPresentationCapability());
      assert.deepStrictEqual(
        yield* WatchLocalCapabilities.pipe(Effect.provide(webWatchLocalCapabilitiesLayer)),
        {
          canPresentLocalFile: true,
          canReceiveProgramMedia: true,
          canRenderWatch: true,
          canControlWatch: true,
        },
      );
      Object.assign(video, { captureStream: undefined });
      assert.isFalse(yield* detectPresentationCapability());
    });
  });
});

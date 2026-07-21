import { assert, describe, it } from '@effect/vitest';
import {
  WatchAlongPlatform,
  WatchLocalCapabilities,
  type WatchCapabilities,
  type WatchSourceEvent,
} from '@tether/client-runtime/modules/watch-along';
import {
  describeWatchAlongPlatformContract,
  type WatchAlongPlatformTestHarness,
} from '@tether/test-support/watch-along-platform-contract';
import { Effect, Fiber, Layer } from 'effect';
import { afterEach, vi } from 'vitest';

import { webWatchAlongPlatformLayer } from './platform';
import { prepareWatchSource, waitForWatchSourceReady, WebWatchSourceError } from './source-adapter';
import {
  FakeWatchStream,
  FakeWatchVideo,
  makeWatchSourceTestFixture,
} from './test/WatchSourceTestHarness';

const capabilities: WatchCapabilities = {
  canPresentLocalFile: true,
  canReceiveProgramMedia: true,
  canRenderWatch: true,
  canControlWatch: true,
};

const installMediaReadyConstant = () => {
  vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3 });
};

const makeWebWatchPlatformHarness = (): WatchAlongPlatformTestHarness => {
  installMediaReadyConstant();
  return {
    layer: Layer.merge(
      webWatchAlongPlatformLayer,
      Layer.succeed(WatchLocalCapabilities, capabilities),
    ),
    capabilities,
    makeSource: makeWatchSourceTestFixture().pipe(
      Effect.map((fixture) => ({
        source: fixture.prepared.source,
        expectedStreamValue: fixture.expectedStream.value,
        emit: (event) => fixture.video.emit(event),
        observations: {
          releaseCount: () => fixture.revoked.length,
          playCount: () => fixture.video.playCount,
          pauseCount: () => fixture.video.pauseCount,
          primedCount: () => fixture.video.currentTimeWriteCount - 1,
        },
      })),
    ),
  };
};

afterEach(() => vi.unstubAllGlobals());

describeWatchAlongPlatformContract('web', makeWebWatchPlatformHarness);

describe('web watch source', () => {
  it.effect('captures one audio/video stream and releases it once', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const fixture = yield* makeWatchSourceTestFixture();
      assert.strictEqual(fixture.video.captureCount, 1);
      assert.strictEqual(fixture.stream.videoTrack?.contentHint, 'detail');

      yield* Effect.promise(fixture.prepared.cancel);
      yield* Effect.promise(fixture.prepared.cancel);
      assert.deepStrictEqual(fixture.revoked, ['blob:watch-source']);
      assert.strictEqual(fixture.stream.videoTrack?.stopCount, 1);
      assert.strictEqual(fixture.stream.audioTrack?.stopCount, 1);
    });
  });

  it.effect('uses browser URL and media element APIs', () => {
    installMediaReadyConstant();
    const video = new FakeWatchVideo();
    const revoked: string[] = [];
    vi.stubGlobal('document', {
      hidden: false,
      createElement: () => video,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:production',
      revokeObjectURL: (url: string) => void revoked.push(url),
    });

    return Effect.gen(function* () {
      const prepared = yield* prepareWatchSource({ type: 'video/mp4' } as File);
      assert.strictEqual(video.src, 'blob:production');
      yield* Effect.promise(prepared.cancel);
      assert.deepStrictEqual(revoked, ['blob:production']);
    });
  });

  it.effect('waits for decodable media and reports decode errors', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const video = new FakeWatchVideo();
      video.readyState = 0;
      const ready = yield* waitForWatchSourceReady(video as unknown as HTMLMediaElement).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      video.emit('canplay');
      yield* Fiber.join(ready);

      const failed = new FakeWatchVideo();
      failed.readyState = 0;
      const failure = yield* waitForWatchSourceReady(failed as unknown as HTMLMediaElement).pipe(
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      failed.emit('error');
      assert.instanceOf(yield* Fiber.join(failure), WebWatchSourceError);
    });
  });

  it.effect('observes playback state', () => {
    installMediaReadyConstant();
    return Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeWatchSourceTestFixture();
        const platform = yield* WatchAlongPlatform;
        const source = yield* platform.claimSource(fixture.prepared.source);
        const events: WatchSourceEvent[] = [];
        yield* platform.observeSource(source, (event) => events.push(event));
        fixture.video.emit('playing');
        fixture.video.emit('ended');
        fixture.video.emit('error');
        assert.deepStrictEqual(
          events.map((event) => event._tag),
          ['SourcePlaying', 'SourceEnded', 'SourceFailed'],
        );
      }).pipe(Effect.provide(webWatchAlongPlatformLayer)),
    );
  });

  it.effect('rejects unsupported files and sources without video', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const unsupported = new FakeWatchVideo();
      unsupported.canPlay = '';
      assert.instanceOf(
        yield* makeWatchSourceTestFixture(unsupported).pipe(Effect.flip),
        WebWatchSourceError,
      );

      const noVideo = new FakeWatchVideo(new FakeWatchStream({ video: false }));
      assert.instanceOf(
        yield* makeWatchSourceTestFixture(noVideo).pipe(Effect.flip),
        WebWatchSourceError,
      );

      const noAudio = yield* makeWatchSourceTestFixture(
        new FakeWatchVideo(new FakeWatchStream({ audio: false })),
      );
      yield* Effect.promise(noAudio.prepared.cancel);
    });
  });
});

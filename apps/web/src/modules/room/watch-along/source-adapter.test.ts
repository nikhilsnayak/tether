import { assert, describe, it } from '@effect/vitest';
import {
  WatchAlongPlatform,
  WatchLocalCapabilities,
  WatchPlatformError,
  type ClaimedSourceHandle,
  type PreparedSourceHandle,
  type ProgramStreamHandle,
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
import {
  prepareWatchSource,
  waitForWatchSourceReady,
  WebWatchSourceError,
  type WebWatchSourceResource,
} from './source-adapter';
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

  it.effect('maps source operation failures at the platform boundary', () => {
    const sourceFailure = new WebWatchSourceError({ operation: 'play', cause: 'failure' });
    const resource: WebWatchSourceResource = {
      element: {} as WebWatchSourceResource['element'],
      stream: {} as MediaStream,
      claim: Effect.fail(sourceFailure),
      cancel: Effect.void,
      play: Effect.fail(sourceFailure),
      pause: Effect.fail(sourceFailure),
      seek: () => Effect.fail(sourceFailure),
      observe: () => Effect.fail(sourceFailure),
      primeFirstFrame: Effect.fail(sourceFailure),
    };
    const source = { value: resource } satisfies ClaimedSourceHandle;

    return Effect.gen(function* () {
      const platform = yield* WatchAlongPlatform;
      const invalidPrepared = { value: null } satisfies PreparedSourceHandle;
      const invalidClaimed = { value: null } satisfies ClaimedSourceHandle;
      const errors = yield* Effect.all([
        platform.cancelPreparedSource(invalidPrepared).pipe(Effect.flip),
        platform.programStream(invalidClaimed).pipe(Effect.flip),
        platform.play(source).pipe(Effect.flip),
        platform.pause(source).pipe(Effect.flip),
        platform.seek(source, 0).pipe(Effect.flip),
        platform.observeSource(source, () => {}).pipe(Effect.flip),
        platform.primeFirstFrame(source).pipe(Effect.flip),
        platform.attachProgramTracks({ value: {} } satisfies ProgramStreamHandle).pipe(Effect.flip),
        platform.clearProgramTracks.pipe(Effect.flip),
      ]);

      assert.deepStrictEqual(
        errors.map((error) => error.operation),
        [
          'cancel-prepared-source',
          'program-stream',
          'play',
          'pause',
          'seek',
          'observe-source',
          'prime-first-frame',
          'attach-program-tracks',
          'clear-program-tracks',
        ],
      );
      for (const error of errors) assert.instanceOf(error, WatchPlatformError);
    }).pipe(Effect.provide(webWatchAlongPlatformLayer));
  });

  it.effect('maps a browser play rejection to a platform failure', () => {
    installMediaReadyConstant();
    const video = new FakeWatchVideo();
    video.playFailure = new Error('autoplay blocked');

    return Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeWatchSourceTestFixture(video);
        const platform = yield* WatchAlongPlatform;
        const source = yield* platform.claimSource(fixture.prepared.source);
        const error = yield* platform.play(source).pipe(Effect.flip);

        assert.instanceOf(error, WatchPlatformError);
        assert.strictEqual(error.operation, 'play');
      }).pipe(Effect.provide(webWatchAlongPlatformLayer)),
    );
  });

  it.effect('maps unavailable source duration to a seek failure', () => {
    installMediaReadyConstant();
    const video = new FakeWatchVideo();
    video.duration = 0;

    return Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeWatchSourceTestFixture(video);
        const platform = yield* WatchAlongPlatform;
        const source = yield* platform.claimSource(fixture.prepared.source);
        const error = yield* platform.seek(source, 0.5).pipe(Effect.flip);

        assert.instanceOf(error, WatchPlatformError);
        assert.strictEqual(error.operation, 'seek');
      }).pipe(Effect.provide(webWatchAlongPlatformLayer)),
    );
  });
});

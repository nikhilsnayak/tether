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
import { TestClock } from 'effect/testing';
import { afterEach, vi } from 'vitest';

import { programMediaStreamValue, webWatchAlongPlatformLayer } from './platform';
import {
  prepareWatchSource,
  prepareWatchSourceWith,
  WATCH_SOURCE_READY_TIMEOUT,
  waitForWatchSourceReady,
  WebWatchSourceError,
  type CapturableVideoElement,
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

it('unwraps web program stream handles', () => {
  const stream = {} as MediaStream;

  assert.strictEqual(programMediaStreamValue({ value: stream }), stream);
});

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
      const video = new FakeWatchVideo();
      video.muted = false;
      const fixture = yield* makeWatchSourceTestFixture(video);
      assert.strictEqual(fixture.video.captureCount, 1);
      assert.isTrue(fixture.video.muted);
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
      assert.strictEqual(video.listenerCount('canplay'), 1);
      assert.strictEqual(video.listenerCount('error'), 1);
      video.emit('canplay');
      yield* Fiber.join(ready);
      assert.strictEqual(video.listenerCount('canplay'), 0);
      assert.strictEqual(video.listenerCount('error'), 0);

      const failed = new FakeWatchVideo();
      failed.readyState = 0;
      const failure = yield* waitForWatchSourceReady(failed as unknown as HTMLMediaElement).pipe(
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      failed.emit('error');
      assert.instanceOf(yield* Fiber.join(failure), WebWatchSourceError);
      assert.strictEqual(failed.listenerCount('canplay'), 0);
      assert.strictEqual(failed.listenerCount('error'), 0);
    });
  });

  it.effect('times out media readiness and removes its listeners', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const video = new FakeWatchVideo();
      video.readyState = 0;
      const readiness = yield* waitForWatchSourceReady(video as unknown as HTMLMediaElement).pipe(
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;

      yield* TestClock.adjust(WATCH_SOURCE_READY_TIMEOUT);

      const error = yield* Fiber.join(readiness);
      assert.instanceOf(error, WebWatchSourceError);
      assert.strictEqual(error.operation, 'prepare');
      assert.strictEqual(video.listenerCount('canplay'), 0);
      assert.strictEqual(video.listenerCount('error'), 0);
    });
  });

  it.effect('releases browser resources when media readiness times out', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const video = new FakeWatchVideo();
      video.readyState = 0;
      const revoked: string[] = [];
      const preparation = yield* prepareWatchSourceWith({ type: 'video/mp4' } as File, {
        createObjectURL: () => 'blob:timeout',
        revokeObjectURL: (url) => void revoked.push(url),
        createVideoElement: () => video as unknown as CapturableVideoElement,
      }).pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;

      yield* TestClock.adjust(WATCH_SOURCE_READY_TIMEOUT);

      assert.instanceOf(yield* Fiber.join(preparation), WebWatchSourceError);
      assert.deepStrictEqual(revoked, ['blob:timeout']);
      assert.strictEqual(video.removeSourceCount, 1);
      assert.strictEqual(video.captureCount, 0);
      assert.strictEqual(video.listenerCount('canplay'), 0);
      assert.strictEqual(video.listenerCount('error'), 0);
    });
  });

  it.effect('removes media readiness listeners when interrupted', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const video = new FakeWatchVideo();
      video.readyState = 0;
      const readiness = yield* waitForWatchSourceReady(video as unknown as HTMLMediaElement).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;

      yield* Fiber.interrupt(readiness);

      assert.strictEqual(video.listenerCount('canplay'), 0);
      assert.strictEqual(video.listenerCount('error'), 0);
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
        fixture.video.emit('ended');
        fixture.video.emit('error');
        assert.deepStrictEqual(
          events.map((event) => event._tag),
          ['SourceEnded', 'SourceFailed'],
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
      replay: Effect.fail(sourceFailure),
      observe: () => Effect.fail(sourceFailure),
      primeFirstFrame: Effect.fail(sourceFailure),
    };
    const source = { _tag: 'ClaimedSource', value: resource } satisfies ClaimedSourceHandle;

    return Effect.gen(function* () {
      const platform = yield* WatchAlongPlatform;
      const invalidPrepared = {
        _tag: 'PreparedSource',
        value: null,
      } satisfies PreparedSourceHandle;
      const invalidClaimed = { _tag: 'ClaimedSource', value: null } satisfies ClaimedSourceHandle;
      const errors = yield* Effect.all([
        platform.cancelPreparedSource(invalidPrepared).pipe(Effect.flip),
        platform.programStream(invalidClaimed).pipe(Effect.flip),
        platform.play(source).pipe(Effect.flip),
        platform.pause(source).pipe(Effect.flip),
        platform.replay(source).pipe(Effect.flip),
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
          'replay',
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

  it.effect('replays from zero when source duration is unknown', () => {
    installMediaReadyConstant();
    const video = new FakeWatchVideo();
    video.duration = Number.NaN;
    video.currentTime = 42;

    return Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeWatchSourceTestFixture(video);
        const platform = yield* WatchAlongPlatform;
        const source = yield* platform.claimSource(fixture.prepared.source);
        yield* platform.replay(source);

        assert.strictEqual(video.currentTime, 0);
        assert.strictEqual(video.playCount, 1);
      }).pipe(Effect.provide(webWatchAlongPlatformLayer)),
    );
  });

  it.effect('maps replay reset and play failures to one operation', () => {
    installMediaReadyConstant();
    const resetFailure = new FakeWatchVideo();
    resetFailure.currentTimeFailure = new Error('seek failed');
    const playFailure = new FakeWatchVideo();
    playFailure.playFailure = new Error('play failed');

    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* WatchAlongPlatform;
        const resetFixture = yield* makeWatchSourceTestFixture(resetFailure);
        const resetSource = yield* platform.claimSource(resetFixture.prepared.source);
        const resetError = yield* platform.replay(resetSource).pipe(Effect.flip);
        const playFixture = yield* makeWatchSourceTestFixture(playFailure);
        const playSource = yield* platform.claimSource(playFixture.prepared.source);
        const playError = yield* platform.replay(playSource).pipe(Effect.flip);

        assert.instanceOf(resetError, WatchPlatformError);
        assert.strictEqual(resetError.operation, 'replay');
        assert.instanceOf(playError, WatchPlatformError);
        assert.strictEqual(playError.operation, 'replay');
      }).pipe(Effect.provide(webWatchAlongPlatformLayer)),
    );
  });
});

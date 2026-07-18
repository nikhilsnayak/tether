import { assert, describe, it } from '@effect/vitest';
import {
  WatchAlongPlatform,
  WatchLocalCapabilities,
  WatchPlatformError,
  type WatchCapabilities,
  type WatchSourceEvent,
} from '@tether/client-runtime/modules/watch-along';
import {
  describeWatchAlongPlatformContract,
  type WatchAlongPlatformTestHarness,
} from '@tether/test-support/watch-along-platform-contract';
import { Effect, Fiber, Layer, Scope } from 'effect';
import { afterEach, vi } from 'vitest';

import { webWatchAlongPlatformLayer } from './platform';
import { createProgramAudioPreferencesStore } from './program-audio-preferences';
import {
  prepareWatchSource,
  prepareWatchSourceWith,
  waitForWatchSourceReady,
  WebWatchSourceError,
  type CapturableVideoElement,
  type WatchSourceEnvironment,
} from './source-adapter';
import {
  FakeProgramMonitor,
  FakeVisibilityDocument,
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
        emit: (event) => {
          const type =
            event === 'buffering' ? 'waiting' : event === 'progress' ? 'timeupdate' : event;
          fixture.video.emit(type);
        },
        observations: {
          releaseCount: () => fixture.revoked.length,
          playCount: () => fixture.video.playCount,
          pauseCount: () => fixture.video.pauseCount,
          progress: () => fixture.video.currentTime / fixture.video.duration,
          primedCount: () => fixture.video.currentTimeWriteCount - 1,
        },
      })),
    ),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describeWatchAlongPlatformContract('web', makeWebWatchPlatformHarness);

describe('web watch source adapter', () => {
  it.effect('prepares captureStream tracks and releases provisional ownership once', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const fixture = yield* makeWatchSourceTestFixture();
      assert.strictEqual(fixture.video.preload, 'auto');
      assert.isTrue(fixture.video.playsInline);
      assert.isFalse(fixture.video.muted);
      assert.strictEqual(fixture.video.volume, 1);
      assert.strictEqual(fixture.video.captureCount, 1);
      assert.strictEqual(fixture.stream.videoTrack?.contentHint, 'detail');
      assert.deepStrictEqual(fixture.monitor.applied, []);

      yield* Effect.promise(fixture.prepared.cancel);
      yield* Effect.promise(fixture.prepared.cancel);
      assert.deepStrictEqual(fixture.revoked, ['blob:watch-source']);
      assert.strictEqual(fixture.stream.videoTrack?.stopCount, 1);
      assert.strictEqual(fixture.stream.audioTrack?.stopCount, 1);
      assert.strictEqual(fixture.monitor.disposeCount, 1);
      assert.strictEqual(fixture.video.removeSourceCount, 1);
    });
  });

  it.effect('binds the production adapter to browser URL, media, and monitor APIs', () => {
    installMediaReadyConstant();
    const video = new FakeWatchVideo();
    const monitorTrack = { stop: vi.fn() };
    const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
    const gainNode = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } };
    const destinationNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      stream: { getTracks: () => [monitorTrack] },
    };
    const context = {
      state: 'suspended',
      destination: {},
      createMediaElementSource: () => sourceNode,
      createGain: () => gainNode,
      createMediaStreamDestination: () => destinationNode,
      resume: vi.fn(async () => {
        context.state = 'running';
      }),
      close: vi.fn(async () => {
        context.state = 'closed';
      }),
    };
    const audio = {
      autoplay: false,
      srcObject: null as unknown,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
      setSinkId: vi.fn(async () => {}),
    };
    const visibilityListeners = new Set<() => void>();
    const fakeDocument = {
      hidden: false,
      createElement: (type: string) => (type === 'video' ? video : audio),
      addEventListener: (_type: string, listener: () => void) => visibilityListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        visibilityListeners.delete(listener),
    };
    const revoked: string[] = [];
    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:production',
      revokeObjectURL: (url: string) => void revoked.push(url),
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          return context;
        }
      },
    );

    return Effect.gen(function* () {
      const prepared = yield* prepareWatchSource({ type: 'video/mp4' } as File);
      assert.strictEqual(video.src, 'blob:production');
      assert.strictEqual(audio.srcObject, destinationNode.stream);
      assert.strictEqual(context.resume.mock.calls.length, 1);
      yield* Effect.promise(prepared.cancel);
      assert.deepStrictEqual(revoked, ['blob:production']);
      assert.strictEqual(monitorTrack.stop.mock.calls.length, 1);
    });
  });

  it.effect('waits for canplay and maps decode failure', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const ready = new FakeWatchVideo();
      ready.readyState = 0;
      const readyFiber = yield* waitForWatchSourceReady(ready as unknown as HTMLMediaElement).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      ready.emit('canplay');
      yield* Fiber.join(readyFiber);
      assert.strictEqual(ready.listeners.get('canplay')?.size, 0);

      const failed = new FakeWatchVideo();
      failed.readyState = 0;
      const failedFiber = yield* waitForWatchSourceReady(
        failed as unknown as HTMLMediaElement,
      ).pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;
      failed.emit('error');
      const error = yield* Fiber.join(failedFiber);
      assert.instanceOf(error, WebWatchSourceError);
      assert.strictEqual(failed.listeners.get('error')?.size, 0);
    });
  });

  it.effect('observes source, visibility, and active preference failures', () => {
    installMediaReadyConstant();
    return Effect.scoped(
      Effect.gen(function* () {
        const monitor = new FakeProgramMonitor();
        const fixture = yield* makeWatchSourceTestFixture({ monitor });
        const platform = yield* WatchAlongPlatform;
        const claimed = yield* platform.claimSource(fixture.prepared.source);
        const events: WatchSourceEvent[] = [];
        yield* platform.observeSource(claimed, (event) => events.push(event));
        yield* platform.play(claimed);

        fixture.visibility.emit(true);
        fixture.visibility.emit(true);
        fixture.visibility.emit(false);
        monitor.applyFailure = true;
        fixture.preferences.set({ volume: 0.5, sinkId: 'missing', speakerEnabled: true });
        yield* Effect.yieldNow;

        assert.deepStrictEqual(
          events.map((event) => event._tag),
          ['BackgroundThrottled', 'ForegroundRestored', 'SourceFailed'],
        );
      }).pipe(Effect.provide(webWatchAlongPlatformLayer)),
    );
  });

  it.effect('rejects unsupported files and incomplete captured streams', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const unsupported = new FakeWatchVideo();
      unsupported.canPlay = '';
      const unsupportedError = yield* makeWatchSourceTestFixture({ video: unsupported }).pipe(
        Effect.flip,
      );
      assert.instanceOf(unsupportedError, WebWatchSourceError);

      const noAudio = new FakeWatchVideo(new FakeWatchStream({ audio: false }));
      const noAudioError = yield* makeWatchSourceTestFixture({ video: noAudio }).pipe(Effect.flip);
      assert.instanceOf(noAudioError, WebWatchSourceError);
      assert.deepStrictEqual(
        noAudio.stream.getTracks().map((track) => track.stopCount),
        [1],
      );
    });
  });

  it.effect('maps preparation and platform operation failures', () => {
    installMediaReadyConstant();
    return Effect.gen(function* () {
      const visibility = new FakeVisibilityDocument();
      const preferences = createProgramAudioPreferencesStore();
      const baseEnvironment: WatchSourceEnvironment = {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: () => {},
        createVideoElement: () => new FakeWatchVideo() as unknown as CapturableVideoElement,
        createMonitor: (() => Effect.succeed(new FakeProgramMonitor())) as never,
        visibility,
      };
      const createError = yield* prepareWatchSourceWith(
        { type: 'video/mp4' } as File,
        {
          ...baseEnvironment,
          createObjectURL: () => {
            throw new Error('url');
          },
        },
        preferences,
      ).pipe(Effect.flip);
      assert.strictEqual(createError.operation, 'prepare');

      const captureVideo = new FakeWatchVideo();
      captureVideo.captureFailure = new Error('capture');
      const captureError = yield* prepareWatchSourceWith(
        { type: 'video/mp4' } as File,
        { ...baseEnvironment, createVideoElement: () => captureVideo as never },
        preferences,
      ).pipe(Effect.flip);
      assert.strictEqual(captureError.operation, 'prepare');

      const monitorError = yield* prepareWatchSourceWith(
        { type: 'video/mp4' } as File,
        {
          ...baseEnvironment,
          createMonitor: (() => Effect.fail(new Error('monitor'))) as never,
        },
        preferences,
      ).pipe(Effect.flip);
      assert.strictEqual(monitorError.operation, 'prepare');

      const fixture = yield* makeWatchSourceTestFixture();
      const platform = yield* WatchAlongPlatform;
      const badSource = { value: {} };
      const invalidEffects = [
        platform.cancelPreparedSource(badSource),
        platform.claimSource(badSource),
        platform.programStream(badSource),
        platform.play(badSource),
        platform.pause(badSource),
        platform.seek(badSource, 0.5),
        platform.currentProgress(badSource),
        platform.observeSource(badSource, () => {}),
        platform.primeFirstFrame(badSource),
        platform.attachProgramTracks(badSource),
        platform.clearProgramTracks,
      ];
      for (const invalidEffect of invalidEffects) {
        const invalid = yield* invalidEffect.pipe(Effect.flip);
        assert.instanceOf(invalid, WatchPlatformError);
      }

      const sourceScope = yield* Scope.make();
      const claimed = yield* platform
        .claimSource(fixture.prepared.source)
        .pipe(Scope.provide(sourceScope));
      fixture.video.duration = Number.NaN;
      assert.strictEqual(yield* platform.currentProgress(claimed), 0);
      const seekError = yield* platform.seek(claimed, 0.5).pipe(Effect.flip);
      assert.instanceOf(seekError, WatchPlatformError);
      fixture.video.playFailure = new Error('play');
      const playError = yield* platform.play(claimed).pipe(Effect.flip);
      assert.instanceOf(playError, WatchPlatformError);
    }).pipe(Effect.provide(webWatchAlongPlatformLayer));
  });

  it.effect('ignores invalid progress and unrelated visibility notifications', () => {
    installMediaReadyConstant();
    return Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeWatchSourceTestFixture();
        const platform = yield* WatchAlongPlatform;
        const claimed = yield* platform.claimSource(fixture.prepared.source);
        const events: WatchSourceEvent[] = [];
        yield* platform.observeSource(claimed, (event) => events.push(event));

        fixture.video.duration = Number.NaN;
        fixture.video.emit('timeupdate');
        fixture.visibility.emit(false);
        fixture.visibility.emit(true);
        fixture.video.ended = true;
        fixture.visibility.emit(true);
        assert.deepStrictEqual(events, []);
      }).pipe(Effect.provide(webWatchAlongPlatformLayer)),
    );
  });
});

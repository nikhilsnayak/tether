import { assert, describe, it } from '@effect/vitest';
import {
  WatchAlongPlatform,
  WatchLocalCapabilities,
  WatchPlatformError,
  type PreparedSourceHandle,
  type WatchCapabilities,
  type WatchSourceEvent,
} from '@tether/client-runtime/modules/watch-along';
import { Effect, Exit, type Layer, Scope } from 'effect';

export interface WatchAlongSourceFixture {
  readonly source: PreparedSourceHandle;
  readonly expectedStreamValue: unknown;
  readonly emit: (event: 'buffering' | 'playing' | 'ended' | 'error' | 'progress') => void;
  readonly observations: {
    readonly releaseCount: () => number;
    readonly playCount: () => number;
    readonly pauseCount: () => number;
    readonly progress: () => number;
    readonly primedCount: () => number;
  };
}

export interface WatchAlongPlatformTestHarness {
  readonly layer: Layer.Layer<WatchAlongPlatform | WatchLocalCapabilities>;
  readonly capabilities: WatchCapabilities;
  readonly makeSource?: Effect.Effect<WatchAlongSourceFixture, unknown>;
}

export const describeWatchAlongPlatformContract = (
  platformName: string,
  makeHarness: () => WatchAlongPlatformTestHarness,
  localPresentation: 'supported' | 'unsupported' = 'supported',
) => {
  describe(`${platformName} watch-along platform contract`, () => {
    it.effect('advertises immutable local capabilities', () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        assert.deepStrictEqual(yield* WatchLocalCapabilities, harness.capabilities);
      }).pipe(Effect.provide(harness.layer));
    });

    if (localPresentation === 'unsupported') {
      it.effect('rejects unsupported local presentation with typed failures', () => {
        const harness = makeHarness();
        return Effect.gen(function* () {
          const platform = yield* WatchAlongPlatform;
          const prepared = { value: Symbol('unsupported-prepared-source') };
          const claimed = { value: Symbol('unsupported-claimed-source') };
          const failures = yield* Effect.all([
            platform.cancelPreparedSource(prepared).pipe(Effect.flip),
            platform.claimSource(prepared).pipe(Effect.flip),
            platform.programStream(claimed).pipe(Effect.flip),
            platform.play(claimed).pipe(Effect.flip),
            platform.pause(claimed).pipe(Effect.flip),
            platform.seek(claimed, 0.5).pipe(Effect.flip),
            platform.currentProgress(claimed).pipe(Effect.flip),
            Effect.scoped(platform.observeSource(claimed, () => {})).pipe(Effect.flip),
            platform.primeFirstFrame(claimed).pipe(Effect.flip),
          ]);
          for (const failure of failures) assert.instanceOf(failure, WatchPlatformError);
          yield* platform.attachProgramTracks({ value: null });
          yield* platform.clearProgramTracks;
        }).pipe(Effect.provide(harness.layer));
      });
      return;
    }

    it.effect('cancels an unclaimed source exactly once', () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const fixture = yield* harness.makeSource!;
        const platform = yield* WatchAlongPlatform;
        yield* platform.cancelPreparedSource(fixture.source);
        yield* platform.cancelPreparedSource(fixture.source);
        assert.strictEqual(fixture.observations.releaseCount(), 1);
      }).pipe(Effect.provide(harness.layer));
    });

    it.effect('transfers playback ownership into the claiming scope', () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const fixture = yield* harness.makeSource!;
        const platform = yield* WatchAlongPlatform;
        const sourceScope = yield* Scope.make();
        const claimed = yield* platform
          .claimSource(fixture.source)
          .pipe(Scope.provide(sourceScope));
        const duplicate = yield* platform
          .claimSource(fixture.source)
          .pipe(Scope.provide(sourceScope), Effect.flip);
        assert.instanceOf(duplicate, WatchPlatformError);
        assert.strictEqual(
          (yield* platform.programStream(claimed)).value,
          fixture.expectedStreamValue,
        );

        const events: WatchSourceEvent[] = [];
        yield* platform
          .observeSource(claimed, (event) => events.push(event))
          .pipe(Scope.provide(sourceScope));
        yield* platform.play(claimed);
        yield* platform.seek(claimed, 0.25);
        assert.strictEqual(yield* platform.currentProgress(claimed), 0.25);
        yield* platform.pause(claimed);
        yield* platform.primeFirstFrame(claimed);
        fixture.emit('buffering');
        fixture.emit('playing');
        fixture.emit('progress');
        fixture.emit('ended');
        fixture.emit('error');

        assert.deepStrictEqual(
          events.map((event) => event._tag),
          ['SourceBuffering', 'SourcePlaying', 'SourceProgress', 'SourceEnded', 'SourceFailed'],
        );
        assert.strictEqual(fixture.observations.playCount(), 1);
        assert.strictEqual(fixture.observations.pauseCount(), 1);
        assert.strictEqual(fixture.observations.progress(), 0.25);
        assert.strictEqual(fixture.observations.primedCount(), 1);

        yield* platform.cancelPreparedSource(fixture.source);
        assert.strictEqual(fixture.observations.releaseCount(), 0);
        yield* Scope.close(sourceScope, Exit.void);
        yield* Scope.close(sourceScope, Exit.void);
        assert.strictEqual(fixture.observations.releaseCount(), 1);
      }).pipe(Effect.provide(harness.layer));
    });
  });
};

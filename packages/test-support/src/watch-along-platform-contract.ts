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
  readonly emit: (event: 'ended' | 'error') => void;
  readonly observations: {
    readonly releaseCount: () => number;
    readonly playCount: () => number;
    readonly pauseCount: () => number;
    readonly primedCount: () => number;
  };
}

export interface WatchAlongPlatformTestHarness {
  readonly layer: Layer.Layer<WatchAlongPlatform | WatchLocalCapabilities>;
  readonly capabilities: WatchCapabilities;
  readonly makeSource: Effect.Effect<WatchAlongSourceFixture, unknown>;
}

export const describeWatchAlongPlatformContract = (
  platformName: string,
  makeHarness: () => WatchAlongPlatformTestHarness,
) => {
  describe(`${platformName} watch-along platform contract`, () => {
    it.effect('advertises immutable local capabilities', () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        assert.deepStrictEqual(yield* WatchLocalCapabilities, harness.capabilities);
      }).pipe(Effect.provide(harness.layer));
    });

    it.effect('cancels an unclaimed source exactly once', () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const fixture = yield* harness.makeSource;
        const platform = yield* WatchAlongPlatform;
        yield* platform.cancelPreparedSource(fixture.source);
        yield* platform.cancelPreparedSource(fixture.source);
        assert.strictEqual(fixture.observations.releaseCount(), 1);
      }).pipe(Effect.provide(harness.layer));
    });

    it.effect('transfers playback ownership into the claiming scope', () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const fixture = yield* harness.makeSource;
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
        yield* platform.replay(claimed);
        yield* platform.pause(claimed);
        yield* platform.primeFirstFrame(claimed);
        fixture.emit('ended');
        fixture.emit('error');

        assert.deepStrictEqual(
          events.map((event) => event._tag),
          ['SourceEnded', 'SourceFailed'],
        );
        assert.strictEqual(fixture.observations.playCount(), 2);
        assert.strictEqual(fixture.observations.pauseCount(), 1);
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

import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import type { WatchSessionView } from './Model';
import { WatchSessionId } from './Protocol';
import { makeWatchActorTestHarness } from './test/WatchActorTestHarness';

const sessionA = WatchSessionId.make('watch-aaaa-01');

const idleView: WatchSessionView = {
  status: 'idle',
  role: null,
  progress: 0,
  revision: 0,
  controlsEnabled: false,
  canPresent: true,
  bufferingReason: null,
};

const unavailableView: WatchSessionView = { ...idleView, status: 'unavailable', canPresent: false };

describe('watch actor — capability exchange', () => {
  it.effect('sends hello on channel open and enters idle on a compatible peer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness();

        yield* h.openChannel();
        assert.deepStrictEqual(h.sent, [
          {
            version: 1,
            type: 'hello',
            canPresentLocalFile: true,
            canReceiveProgramMedia: true,
            canRenderWatch: true,
            canControlWatch: true,
          },
        ]);
        assert.deepStrictEqual(h.events, []);

        yield* h.receiveHello();
        assert.deepStrictEqual(h.events, [
          { _tag: 'WatchAvailabilityChanged', available: true },
          { _tag: 'WatchSessionChanged', view: idleView },
        ]);
      }),
    ),
  );

  it.effect('stays unavailable when the peer capabilities are incompatible', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness();

        yield* h.openChannel();
        yield* h.receiveHello({ canRenderWatch: false });

        assert.deepStrictEqual(h.events, []);
      }),
    ),
  );

  it.effect('stays unavailable when neither side can present', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness({
          capabilities: { canPresentLocalFile: false },
        });

        yield* h.openChannel();
        yield* h.receiveHello({ canPresentLocalFile: false });

        assert.deepStrictEqual(h.events, []);
      }),
    ),
  );

  it.effect('treats a pre-capability channel close as a quiet availability failure', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness();

        yield* h.openChannel();
        yield* h.closeChannel();

        assert.deepStrictEqual(h.events, []);
      }),
    ),
  );

  it.effect('fails watch-along closed when the channel drops after capability', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness();

        yield* h.openChannel();
        yield* h.receiveHello();
        const before = h.events.length;

        yield* h.closeChannel();

        assert.deepStrictEqual(h.events.slice(before), [
          { _tag: 'WatchAvailabilityChanged', available: false },
          { _tag: 'WatchSessionChanged', view: unavailableView },
        ]);
      }),
    ),
  );

  it.effect('starts unavailable and ignores watch traffic before capability', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness();

        assert.deepStrictEqual(h.events, []);

        yield* h.peerProposes(sessionA);

        assert.deepStrictEqual(h.events, []);
        assert.deepStrictEqual(h.sent, []);
      }),
    ),
  );
});

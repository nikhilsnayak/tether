import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import { WATCH_PROTOCOL_VERSION, WatchSessionId } from './Protocol';
import {
  makeWatchActorTestHarness,
  programStreamHandle,
  remoteStreamHandle,
} from './test/WatchActorTestHarness';

const sessionId = WatchSessionId.make('watch-test-01');

describe('minimal watch actor', () => {
  it.effect('presents a source and applies shared playback controls', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watch = yield* makeWatchActorTestHarness();
        yield* watch.openChannel();
        yield* watch.receiveHello();
        assert.strictEqual(watch.lastView()?.status, 'idle');

        yield* watch.propose();
        const proposal = watch.lastSent();
        assert.strictEqual(proposal?.type, 'watch-proposed');
        if (proposal?.type !== 'watch-proposed') return;
        yield* watch.receiveReady(proposal.watchSessionId);
        assert.strictEqual(watch.lastView()?.status, 'loaded-paused');
        assert.deepInclude(watch.events, {
          _tag: 'WatchProgramStreamReady',
          stream: programStreamHandle,
        });

        yield* watch.requestControl({ kind: 'play' });
        assert.strictEqual(watch.lastView()?.status, 'playing');
        assert.include(watch.operations, 'play');
        yield* watch.requestControl({ kind: 'pause' });
        assert.strictEqual(watch.lastView()?.status, 'loaded-paused');
        yield* watch.requestControl({ kind: 'eject' });
        assert.strictEqual(watch.lastView()?.status, 'idle');
        assert.include(watch.operations, 'closeSourceScope');
      }),
    ),
  );

  it.effect('receives a remote stream and forwards controls to its presenter', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watch = yield* makeWatchActorTestHarness({ role: 'guest' });
        yield* watch.openChannel();
        yield* watch.receiveHello();
        yield* watch.remoteStream(remoteStreamHandle, 1);
        yield* watch.peerProposes(sessionId);
        assert.strictEqual(watch.lastSent()?.type, 'watch-ready');
        yield* watch.receiveCanonical(sessionId, {
          status: 'loaded-paused',
        });
        assert.strictEqual(watch.lastView()?.role, 'watcher');
        assert.deepInclude(watch.events, {
          _tag: 'WatchProgramStreamReady',
          stream: remoteStreamHandle,
        });

        yield* watch.requestControl({ kind: 'play' });
        assert.deepStrictEqual(watch.lastSent(), {
          version: WATCH_PROTOCOL_VERSION,
          type: 'control-requested',
          watchSessionId: sessionId,
          control: { kind: 'play' },
        });
      }),
    ),
  );

  it.effect('ends only watch when the source fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watch = yield* makeWatchActorTestHarness();
        yield* watch.openChannel();
        yield* watch.receiveHello();
        yield* watch.propose();
        const proposal = watch.lastSent();
        if (proposal?.type !== 'watch-proposed') return;
        yield* watch.receiveReady(proposal.watchSessionId);
        yield* watch.sourceEvent({ _tag: 'SourceFailed' });
        assert.strictEqual(watch.lastView()?.status, 'idle');
        assert.strictEqual(watch.lastSent()?.type, 'watch-failed');
      }),
    ),
  );
});

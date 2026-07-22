import { assert, describe, it } from '@effect/vitest';
import { Deferred, Effect } from 'effect';

import { WATCH_PROTOCOL_VERSION, WatchSessionId } from './Protocol';
import { WatchPlatformError } from './Services';
import {
  makeWatchActorTestHarness,
  preparedSource,
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

  it.effect('cancels local preparation and rejects proposals while busy', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watch = yield* makeWatchActorTestHarness();
        yield* watch.receiveHello();

        yield* watch.requestControl({ kind: 'play' });
        yield* watch.receiveReady(sessionId);
        yield* watch.receiveRejected(sessionId);
        yield* watch.cancel();
        yield* watch.receiveCanonical(sessionId, { status: 'playing' });
        yield* watch.input({ _tag: 'SourceEnded' });
        assert.strictEqual(watch.lastView()?.status, 'idle');

        yield* watch.propose();
        yield* watch.peerProposes(sessionId);
        assert.deepStrictEqual(watch.lastSent(), {
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-rejected',
          watchSessionId: sessionId,
          reason: 'busy',
        });
        yield* watch.cancel();
        assert.strictEqual(watch.lastView()?.status, 'idle');
        assert.include(watch.operations, 'cancelPreparedSource');

        yield* watch.propose();
        const proposal = watch.lastSent();
        assert.strictEqual(proposal?.type, 'watch-proposed');
        if (proposal?.type !== 'watch-proposed') return;
        yield* watch.receiveRejected(sessionId);
        assert.strictEqual(watch.lastView()?.status, 'preparing-local');
        yield* watch.receiveRejected(proposal.watchSessionId);
        assert.strictEqual(watch.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('ends a pending proposal for both peers when either side cancels', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const presenter = yield* makeWatchActorTestHarness();
        yield* presenter.receiveHello();
        yield* presenter.propose();
        const proposal = presenter.lastSent();
        if (proposal?.type !== 'watch-proposed') return;

        yield* presenter.cancel();
        assert.deepStrictEqual(presenter.lastSent(), {
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ended',
          watchSessionId: proposal.watchSessionId,
        });
        assert.strictEqual(presenter.lastView()?.status, 'idle');

        const watcher = yield* makeWatchActorTestHarness();
        yield* watcher.receiveHello();
        yield* watcher.peerProposes(sessionId);
        yield* watcher.cancel();
        assert.deepStrictEqual(watcher.lastSent(), {
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ended',
          watchSessionId: sessionId,
        });
        assert.strictEqual(watcher.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('honors cancellation queued while a proposal becomes active', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const continueStartup = yield* Deferred.make<void>();
        const watch = yield* makeWatchActorTestHarness({
          overrides: { primeFirstFrame: () => Deferred.await(continueStartup) },
        });
        yield* watch.receiveHello();
        yield* watch.propose();
        const proposal = watch.lastSent();
        if (proposal?.type !== 'watch-proposed') return;

        yield* watch.receiveReady(proposal.watchSessionId);
        yield* watch.enqueue({ _tag: 'Cancel' });
        yield* Deferred.succeed(continueStartup, undefined);
        yield* watch.settle;

        assert.strictEqual(watch.lastView()?.status, 'idle');
        assert.deepStrictEqual(watch.lastSent(), {
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ended',
          watchSessionId: proposal.watchSessionId,
        });
        assert.include(watch.operations, 'closeSourceScope');
      }),
    ),
  );

  it.effect('releases a prepared source when its actor scope closes', () =>
    Effect.gen(function* () {
      const operations = yield* Effect.scoped(
        Effect.gen(function* () {
          const watch = yield* makeWatchActorTestHarness();
          yield* watch.receiveHello();
          yield* watch.propose();
          return watch.operations;
        }),
      );

      assert.include(operations, 'cancelPreparedSource');
    }),
  );

  it.effect('cancels a proposal when local presentation is unavailable', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watch = yield* makeWatchActorTestHarness({
          capabilities: { canPresentLocalFile: false },
        });
        yield* watch.receiveHello();
        yield* watch.propose(preparedSource);

        assert.strictEqual(watch.lastView()?.status, 'idle');
        assert.include(watch.operations, 'cancelPreparedSource');
      }),
    ),
  );

  it.effect('applies presenter replay, remote controls, and source state', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watch = yield* makeWatchActorTestHarness();
        yield* watch.receiveHello();
        yield* watch.receiveHello();
        yield* watch.propose();
        const proposal = watch.lastSent();
        if (proposal?.type !== 'watch-proposed') return;
        yield* watch.receiveReady(sessionId);
        assert.strictEqual(watch.lastView()?.status, 'preparing-local');
        yield* watch.receiveReady(proposal.watchSessionId);

        yield* watch.requestControl({ kind: 'replay' });
        assert.include(watch.operations, 'seek:0');
        assert.include(watch.operations, 'play');
        yield* watch.receive({
          version: WATCH_PROTOCOL_VERSION,
          type: 'control-requested',
          watchSessionId: sessionId,
          control: { kind: 'pause' },
        });
        assert.strictEqual(watch.lastView()?.status, 'playing');
        yield* watch.receive({
          version: WATCH_PROTOCOL_VERSION,
          type: 'control-requested',
          watchSessionId: proposal.watchSessionId,
          control: { kind: 'pause' },
        });
        assert.strictEqual(watch.lastView()?.status, 'loaded-paused');

        yield* watch.sourceEvent({ _tag: 'SourcePlaying' });
        assert.strictEqual(watch.lastView()?.status, 'playing');
        yield* watch.sourceEvent({ _tag: 'SourceEnded' });
        assert.strictEqual(watch.lastView()?.status, 'ended');
        yield* watch.receiveEnded(sessionId);
        assert.strictEqual(watch.lastView()?.status, 'ended');
        yield* watch.receiveEnded(proposal.watchSessionId);
        assert.strictEqual(watch.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('tracks watcher stream replacement and canonical updates', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watch = yield* makeWatchActorTestHarness();
        yield* watch.receiveHello();
        yield* watch.peerProposes(sessionId);
        yield* watch.receiveCanonical(WatchSessionId.make('wrong-session'), {
          status: 'playing',
        });
        assert.strictEqual(watch.lastView()?.status, 'awaiting-remote-start');

        yield* watch.remoteStream(remoteStreamHandle, 1);
        yield* watch.receiveCanonical(sessionId, { status: 'loaded-paused' });
        yield* watch.receiveCanonical(sessionId, { status: 'playing' });
        assert.strictEqual(watch.lastView()?.status, 'playing');

        const beforeStale = watch.events.length;
        yield* watch.remoteStream(programStreamHandle, 1);
        assert.strictEqual(watch.events.length, beforeStale);
        yield* watch.remoteStream(null, 2);
        assert.strictEqual(watch.events.at(-1)?._tag, 'WatchProgramStreamCleared');
        yield* watch.remoteStream(programStreamHandle, 3);
        assert.deepStrictEqual(watch.events.at(-1), {
          _tag: 'WatchProgramStreamReady',
          stream: programStreamHandle,
        });

        yield* watch.receiveFailed(WatchSessionId.make('wrong-session'), 'attachment');
        assert.strictEqual(watch.lastView()?.status, 'playing');
        yield* watch.receiveFailed(sessionId, 'attachment');
        assert.strictEqual(watch.lastView()?.status, 'idle');
        assert.deepInclude(watch.events, { _tag: 'WatchFailed', reason: 'attachment' });
      }),
    ),
  );

  it.effect('ends an awaiting remote proposal', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watch = yield* makeWatchActorTestHarness();
        yield* watch.receiveHello();
        yield* watch.peerProposes(sessionId);
        yield* watch.receiveCanonical(sessionId, { status: 'loaded-paused' });
        assert.strictEqual(watch.lastView()?.status, 'loaded-paused');
        yield* watch.receiveEnded(sessionId);

        assert.strictEqual(watch.lastView()?.status, 'idle');

        const awaiting = yield* makeWatchActorTestHarness();
        yield* awaiting.receiveHello();
        yield* awaiting.peerProposes(sessionId);
        yield* awaiting.receiveEnded(sessionId);
        assert.strictEqual(awaiting.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('recovers from source startup and control failures', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startup = yield* makeWatchActorTestHarness({
          overrides: {
            claimSource: () =>
              Effect.fail(new WatchPlatformError({ operation: 'claim-source', cause: 'failed' })),
          },
        });
        yield* startup.receiveHello();
        yield* startup.propose();
        const startupProposal = startup.lastSent();
        if (startupProposal?.type !== 'watch-proposed') return;
        yield* startup.receiveReady(startupProposal.watchSessionId);
        assert.strictEqual(startup.lastView()?.status, 'idle');
        assert.deepInclude(startup.events, { _tag: 'WatchFailed', reason: 'source' });

        const localControl = yield* makeWatchActorTestHarness({
          overrides: {
            play: () => Effect.fail(new WatchPlatformError({ operation: 'play', cause: 'failed' })),
          },
        });
        yield* localControl.receiveHello();
        yield* localControl.propose();
        const localProposal = localControl.lastSent();
        if (localProposal?.type !== 'watch-proposed') return;
        yield* localControl.receiveReady(localProposal.watchSessionId);
        yield* localControl.requestControl({ kind: 'play' });
        assert.strictEqual(localControl.lastView()?.status, 'idle');

        const remoteControl = yield* makeWatchActorTestHarness({
          overrides: {
            play: () => Effect.fail(new WatchPlatformError({ operation: 'play', cause: 'failed' })),
          },
        });
        yield* remoteControl.receiveHello();
        yield* remoteControl.propose();
        const remoteProposal = remoteControl.lastSent();
        if (remoteProposal?.type !== 'watch-proposed') return;
        yield* remoteControl.receiveReady(remoteProposal.watchSessionId);
        yield* remoteControl.receive({
          version: WATCH_PROTOCOL_VERSION,
          type: 'control-requested',
          watchSessionId: remoteProposal.watchSessionId,
          control: { kind: 'play' },
        });
        assert.strictEqual(remoteControl.lastView()?.status, 'idle');
      }),
    ),
  );
});

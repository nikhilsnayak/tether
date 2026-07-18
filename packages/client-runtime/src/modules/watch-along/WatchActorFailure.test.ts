import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import { WatchSessionId, type WatchMessage, type WatchProposed } from './Protocol';
import { WatchPlatformError } from './Services';
import {
  makeWatchActorTestHarness,
  remoteStreamHandle,
  type WatchHarnessOptions,
} from './test/WatchActorTestHarness';

const platformFailure = (operation: string) => () =>
  Effect.fail(new WatchPlatformError({ operation: operation as never, cause: 'boom' }));

const sessionA = WatchSessionId.make('watch-aaaa-01');

const proposedId = (sent: ReadonlyArray<WatchMessage>): WatchSessionId => {
  const message = sent.find((m): m is WatchProposed => m.type === 'watch-proposed');
  assert.isDefined(message);
  return (message as WatchProposed).watchSessionId;
};

const startPresenter = Effect.fnUntraced(function* (options?: WatchHarnessOptions) {
  const h = yield* makeWatchActorTestHarness(options);
  yield* h.openChannel();
  yield* h.receiveHello();
  yield* h.propose();
  const id = proposedId(h.sent);
  yield* h.receiveReady(id);
  return { h, id };
});

const startPresenterPlaying = Effect.fnUntraced(function* (options?: WatchHarnessOptions) {
  const started = yield* startPresenter(options);
  yield* started.h.requestControl({ kind: 'play' });
  return started;
});

const startWatcher = Effect.fnUntraced(function* (id: WatchSessionId) {
  const h = yield* makeWatchActorTestHarness({
    role: 'guest',
    capabilities: { canPresentLocalFile: false },
  });
  yield* h.openChannel();
  yield* h.receiveHello();
  yield* h.peerProposes(id);
  yield* h.receiveStarted(id);
  yield* h.receiveCanonical(id, {
    authorityEpoch: 0,
    revision: 0,
    status: 'loaded-paused',
    progress: 0,
  });
  return h;
});

describe('watch actor — failure, interruption, and recovery', () => {
  it.effect('reflects source buffering and resume', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenterPlaying();

        yield* h.sourceEvent({ _tag: 'SourceBuffering' });
        assert.strictEqual(h.lastView()?.status, 'buffering');
        assert.strictEqual(h.lastView()?.bufferingReason, 'source');

        yield* h.sourceEvent({ _tag: 'SourcePlaying' });
        assert.strictEqual(h.lastView()?.status, 'playing');
      }),
    ),
  );

  it.effect('enters ended on natural completion', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenterPlaying();

        yield* h.sourceEvent({ _tag: 'SourceEnded' });

        assert.strictEqual(h.lastView()?.status, 'ended');
        assert.strictEqual(h.lastSent()?.type, 'playback-state-changed');
      }),
    ),
  );

  it.effect('tears down on a fatal source failure', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h, id } = yield* startPresenterPlaying();

        yield* h.sourceEvent({ _tag: 'SourceFailed' });

        assert.deepStrictEqual(h.lastSent(), {
          version: 1,
          type: 'watch-failed',
          watchSessionId: id,
          reason: 'source',
        });
        assert.deepInclude(h.operations, 'closeSourceScope');
        assert.deepInclude(h.events, { _tag: 'WatchFailed', reason: 'source' });
        assert.deepInclude(h.events, { _tag: 'WatchProgramStreamCleared' });
        assert.strictEqual(h.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('pauses on background throttle and resumes on foreground', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenterPlaying();

        yield* h.sourceEvent({ _tag: 'BackgroundThrottled' });
        assert.deepInclude(h.operations, 'pause');
        assert.strictEqual(h.lastView()?.status, 'buffering');
        assert.strictEqual(h.lastView()?.bufferingReason, 'background-throttled');

        yield* h.sourceEvent({ _tag: 'ForegroundRestored' });
        assert.strictEqual(h.lastView()?.status, 'playing');
      }),
    ),
  );

  it.effect('fails the pipeline when the restore deadline elapses', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h, id } = yield* startPresenterPlaying();
        yield* h.sourceEvent({ _tag: 'BackgroundThrottled' });

        yield* h.advance('10 seconds');

        assert.deepStrictEqual(h.lastSent(), {
          version: 1,
          type: 'watch-failed',
          watchSessionId: id,
          reason: 'pipeline',
        });
        assert.strictEqual(h.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('recovers a Playing session as loaded-paused across interruption', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenterPlaying();

        yield* h.interrupt();
        assert.deepInclude(h.operations, 'pause');
        assert.strictEqual(h.lastView()?.status, 'loaded-paused');
        assert.strictEqual(h.lastView()?.controlsEnabled, false);

        yield* h.restore();
        const snapshot = h.lastSent();
        assert.strictEqual(snapshot?.type, 'playback-state-changed');
        assert.deepStrictEqual(
          (snapshot as Extract<WatchMessage, { type: 'playback-state-changed' }>).authorityEpoch,
          1,
        );
        assert.strictEqual(h.lastView()?.controlsEnabled, true);
      }),
    ),
  );

  it.effect('keeps an ended session ended across interruption and recovery', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenterPlaying();
        yield* h.sourceEvent({ _tag: 'SourceEnded' });

        yield* h.interrupt();
        assert.strictEqual(h.lastView()?.status, 'ended');
        assert.strictEqual(h.lastView()?.controlsEnabled, false);

        yield* h.restore();
        const snapshot = h.lastSent();
        assert.strictEqual(
          (snapshot as Extract<WatchMessage, { type: 'playback-state-changed' }>).status,
          'ended',
        );
        assert.strictEqual(h.lastView()?.status, 'ended');
      }),
    ),
  );

  it.effect('holds a watcher in recovery until a newer-epoch snapshot', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watcher = yield* startWatcher(sessionA);
        yield* watcher.receiveCanonical(sessionA, {
          authorityEpoch: 0,
          revision: 1,
          status: 'playing',
          progress: 0.2,
        });

        yield* watcher.interrupt();
        assert.strictEqual(watcher.lastView()?.status, 'awaiting-recovery-snapshot');
        assert.strictEqual(watcher.lastView()?.controlsEnabled, false);

        const viewsBefore = watcher.sessionViews().length;
        // A stale-epoch update delivered during recovery is ignored.
        yield* watcher.receiveCanonical(sessionA, {
          authorityEpoch: 0,
          revision: 2,
          status: 'playing',
          progress: 0.9,
        });
        assert.strictEqual(watcher.sessionViews().length, viewsBefore);

        // The newer-epoch snapshot is the sole reconciliation point.
        yield* watcher.receiveCanonical(sessionA, {
          authorityEpoch: 1,
          revision: 3,
          status: 'loaded-paused',
          progress: 0.5,
        });
        assert.strictEqual(watcher.lastView()?.status, 'loaded-paused');
        assert.strictEqual(watcher.lastView()?.progress, 0.5);

        // A late pre-recovery update is still discarded.
        const after = watcher.sessionViews().length;
        yield* watcher.receiveCanonical(sessionA, {
          authorityEpoch: 0,
          revision: 4,
          status: 'playing',
          progress: 1,
        });
        assert.strictEqual(watcher.sessionViews().length, after);
      }),
    ),
  );

  it.effect('ends the watch on channel loss while a session is active', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenterPlaying();

        yield* h.closeChannel();

        assert.deepInclude(h.events, { _tag: 'WatchProgramStreamCleared' });
        assert.deepInclude(h.events, { _tag: 'WatchAvailabilityChanged', available: false });
        assert.deepInclude(h.events, { _tag: 'WatchFailed', reason: 'pipeline' });
        assert.strictEqual(h.lastView()?.status, 'unavailable');
        assert.deepInclude(h.operations, 'closeSourceScope');
      }),
    ),
  );

  it.effect('ends the watch on a local pipeline failure but keeps the transport', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h, id } = yield* startPresenterPlaying();

        yield* h.localPipelineFailed('renderer');

        assert.deepStrictEqual(h.lastSent(), {
          version: 1,
          type: 'watch-failed',
          watchSessionId: id,
          reason: 'renderer',
        });
        assert.deepInclude(h.events, { _tag: 'WatchFailed', reason: 'renderer' });
        assert.strictEqual(h.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('fails closed when the failure message cannot be sent', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenterPlaying();

        h.breakTransport();
        yield* h.localPipelineFailed('pipeline');

        assert.deepInclude(h.events, { _tag: 'WatchAvailabilityChanged', available: false });
        assert.deepInclude(h.events, { _tag: 'WatchFailed', reason: 'pipeline' });
        assert.strictEqual(h.lastView()?.status, 'unavailable');
      }),
    ),
  );

  it.effect('recovers a loaded-paused presenter across interruption', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenter(); // loaded-paused, never played

        yield* h.interrupt();

        assert.strictEqual(h.lastView()?.status, 'loaded-paused');
        assert.strictEqual(h.lastView()?.controlsEnabled, false);
      }),
    ),
  );

  it.effect('ignores foreground restore and a stale restore deadline after resume', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenterPlaying();
        const sentBefore = h.sent.length;
        // Foreground restore while simply playing is a no-op.
        yield* h.sourceEvent({ _tag: 'ForegroundRestored' });
        assert.strictEqual(h.sent.length, sentBefore);

        // Throttle, resume, then let the now-stale restore deadline fire.
        yield* h.sourceEvent({ _tag: 'BackgroundThrottled' });
        yield* h.sourceEvent({ _tag: 'ForegroundRestored' });
        yield* h.advance('10 seconds');
        assert.strictEqual(h.lastView()?.status, 'playing');
      }),
    ),
  );

  it.effect('ends a watcher session on a remote watch-failed for its id only', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watcher = yield* startWatcher(sessionA);

        // A failure for another session is ignored.
        const eventsBefore = watcher.events.length;
        yield* watcher.receiveFailed(WatchSessionId.make('watch-zzzz-99'), 'renderer');
        assert.strictEqual(watcher.events.length, eventsBefore);

        yield* watcher.receiveFailed(sessionA, 'renderer');
        assert.deepInclude(watcher.events, { _tag: 'WatchFailed', reason: 'renderer' });
        assert.strictEqual(watcher.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('handles watch-ended across watcher lifecycle states', () =>
    Effect.scoped(
      Effect.gen(function* () {
        // Ignored while idle.
        const idle = yield* makeWatchActorTestHarness();
        yield* idle.openChannel();
        yield* idle.receiveHello();
        const idleEvents = idle.events.length;
        yield* idle.receiveEnded(sessionA);
        assert.strictEqual(idle.events.length, idleEvents);

        // Accepted before startup completes (AwaitingRemoteStart).
        const awaiting = yield* makeWatchActorTestHarness({
          role: 'guest',
          capabilities: { canPresentLocalFile: false },
        });
        yield* awaiting.openChannel();
        yield* awaiting.receiveHello();
        yield* awaiting.peerProposes(sessionA);
        yield* awaiting.receiveEnded(sessionA);
        assert.strictEqual(awaiting.lastView()?.status, 'idle');

        // Accepted while awaiting a recovery snapshot.
        const recovering = yield* startWatcher(sessionA);
        yield* recovering.interrupt();
        yield* recovering.receiveEnded(sessionA);
        assert.deepInclude(recovering.events, { _tag: 'WatchProgramStreamCleared' });
        assert.strictEqual(recovering.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('ignores a duplicate watch-started', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watcher = yield* startWatcher(sessionA);
        // startWatcher already delivered started + canonical; a second started
        // must not disturb the session.
        yield* watcher.receiveStarted(sessionA);
        assert.strictEqual(watcher.lastView()?.status, 'loaded-paused');
      }),
    ),
  );

  it.effect('routes a local pipeline failure by session presence', () =>
    Effect.scoped(
      Effect.gen(function* () {
        // No session: nothing happens.
        const idle = yield* makeWatchActorTestHarness();
        yield* idle.openChannel();
        yield* idle.receiveHello();
        const idleSent = idle.sent.length;
        yield* idle.localPipelineFailed('pipeline');
        assert.strictEqual(idle.sent.length, idleSent);

        // While preparing: the provisional session id fails out to idle.
        const preparing = yield* makeWatchActorTestHarness();
        yield* preparing.openChannel();
        yield* preparing.receiveHello();
        yield* preparing.propose();
        const id = proposedId(preparing.sent);
        yield* preparing.localPipelineFailed('renderer');
        assert.deepStrictEqual(preparing.lastSent(), {
          version: 1,
          type: 'watch-failed',
          watchSessionId: id,
          reason: 'renderer',
        });
        assert.strictEqual(preparing.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('tolerates platform and transport errors during teardown', () =>
    Effect.scoped(
      Effect.gen(function* () {
        // A failing clearProgramTracks during fatal teardown is swallowed.
        const clearing = yield* startPresenterPlaying({
          overrides: { clearProgramTracks: platformFailure('clear-program-tracks')() },
        });
        yield* clearing.h.sourceEvent({ _tag: 'SourceFailed' });
        assert.strictEqual(clearing.h.lastView()?.status, 'idle');

        // A failing cancelPreparedSource during cancel is swallowed.
        const cancelling = yield* makeWatchActorTestHarness({
          overrides: { cancelPreparedSource: platformFailure('cancel-prepared-source') },
        });
        yield* cancelling.openChannel();
        yield* cancelling.receiveHello();
        yield* cancelling.propose();
        yield* cancelling.cancelPreparing();
        assert.strictEqual(cancelling.lastView()?.status, 'idle');

        // A broken transport during a canonical broadcast is swallowed.
        const broadcasting = yield* startPresenterPlaying();
        broadcasting.h.breakTransport();
        yield* broadcasting.h.requestControl({ kind: 'pause' });
        assert.deepInclude(broadcasting.h.operations, 'pause');
        assert.strictEqual(broadcasting.h.lastView()?.status, 'loaded-paused');
      }),
    ),
  );

  it.effect('ignores duplicate and wrong-state lifecycle inputs', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness();
        yield* h.openChannel();
        yield* h.receiveHello();

        // Once idle these are all no-ops.
        const before = h.events.length;
        yield* h.openChannel();
        yield* h.receiveHello();
        yield* h.cancelPreparing();
        yield* h.receiveReady(sessionA);
        assert.strictEqual(h.events.length, before);
      }),
    ),
  );

  it.effect('ignores a ready for a different proposal and inapplicable lifecycle inputs', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const preparing = yield* makeWatchActorTestHarness();
        yield* preparing.openChannel();
        yield* preparing.receiveHello();
        yield* preparing.propose();
        yield* preparing.receiveReady(WatchSessionId.make('watch-wrong-99'));
        assert.notDeepInclude(preparing.operations, 'claimSource');
        // A rejection for a different (already gone) proposal is ignored too.
        yield* preparing.receiveRejected(WatchSessionId.make('watch-wrong-98'), 'busy');
        assert.notDeepInclude(preparing.operations, 'cancelPreparedSource');

        // Interrupt and restore with no active session are no-ops.
        const idle = yield* makeWatchActorTestHarness();
        yield* idle.openChannel();
        yield* idle.receiveHello();
        const idleEvents = idle.events.length;
        yield* idle.interrupt();
        yield* idle.restore();
        assert.strictEqual(idle.events.length, idleEvents);

        // Background throttle while paused (not playing) is a no-op.
        const { h } = yield* startPresenter();
        const views = h.sessionViews().length;
        yield* h.sourceEvent({ _tag: 'BackgroundThrottled' });
        assert.strictEqual(h.sessionViews().length, views);
      }),
    ),
  );

  it.effect('rejects proposals while starting up or recovering', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const awaiting = yield* makeWatchActorTestHarness({
          role: 'guest',
          capabilities: { canPresentLocalFile: false },
        });
        yield* awaiting.openChannel();
        yield* awaiting.receiveHello();
        yield* awaiting.peerProposes(sessionA);
        yield* awaiting.peerProposes(WatchSessionId.make('watch-bbbb-02'));
        assert.strictEqual(awaiting.lastSent()?.type, 'watch-rejected');

        const recovering = yield* startWatcher(sessionA);
        yield* recovering.interrupt();
        yield* recovering.peerProposes(WatchSessionId.make('watch-cccc-03'));
        assert.strictEqual(recovering.lastSent()?.type, 'watch-rejected');
      }),
    ),
  );

  it.effect('tears down an awaiting-remote-start watcher on channel close', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness({
          role: 'guest',
          capabilities: { canPresentLocalFile: false },
        });
        yield* h.openChannel();
        yield* h.receiveHello();
        yield* h.peerProposes(sessionA);

        yield* h.closeChannel();

        assert.strictEqual(h.lastView()?.status, 'unavailable');
      }),
    ),
  );

  it.effect('ignores session-less lifecycle inputs', () =>
    Effect.scoped(
      Effect.gen(function* () {
        // Local pipeline failure before capability has no session id.
        const fresh = yield* makeWatchActorTestHarness();
        yield* fresh.localPipelineFailed('pipeline');
        assert.deepStrictEqual(fresh.events, []);

        // A presenter ignores an inbound watch-ended (it owns the session).
        const { h } = yield* startPresenterPlaying();
        const before = h.events.length;
        yield* h.receiveEnded(proposedId(h.sent));
        assert.strictEqual(h.events.length, before);
      }),
    ),
  );

  it.effect('reconciles a watcher buffering snapshot with and without a reason', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watcher = yield* startWatcher(sessionA);

        yield* watcher.receiveCanonical(sessionA, {
          authorityEpoch: 0,
          revision: 1,
          status: 'buffering',
          progress: 0.1,
          reason: 'background-throttled',
        });
        assert.strictEqual(watcher.lastView()?.bufferingReason, 'background-throttled');

        yield* watcher.receiveCanonical(sessionA, {
          authorityEpoch: 0,
          revision: 2,
          status: 'buffering',
          progress: 0.2,
        });
        assert.strictEqual(watcher.lastView()?.bufferingReason, 'source');
      }),
    ),
  );

  it.effect('ignores source events outside their valid state', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenter(); // loaded-paused

        const loadedViews = h.sessionViews().length;
        yield* h.sourceEvent({ _tag: 'SourceBuffering' }); // not playing
        yield* h.sourceEvent({ _tag: 'SourceEnded' }); // not playing/buffering
        assert.strictEqual(h.sessionViews().length, loadedViews);

        yield* h.requestControl({ kind: 'play' });
        const playingViews = h.sessionViews().length;
        yield* h.sourceEvent({ _tag: 'SourcePlaying' }); // not buffering
        assert.strictEqual(h.sessionViews().length, playingViews);

        // After eject the source is gone; a late failure is a no-op.
        yield* h.requestControl({ kind: 'eject' });
        const idleEvents = h.events.length;
        yield* h.sourceEvent({ _tag: 'SourceFailed' });
        yield* h.sourceEvent({ _tag: 'SourceProgress', progress: 0.9 });
        assert.strictEqual(h.events.length, idleEvents);
      }),
    ),
  );

  it.effect('ignores a progress sample delivered to a paused watcher', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watcher = yield* startWatcher(sessionA); // loaded-paused

        const before = watcher.sessionViews().length;
        yield* watcher.receive({
          version: 1,
          type: 'progress-sample',
          watchSessionId: sessionA,
          authorityEpoch: 0,
          revision: 0,
          sequence: 1,
          progress: 0.5,
        });
        assert.strictEqual(watcher.sessionViews().length, before);
      }),
    ),
  );

  it.effect('projects newer program streams into an active watcher and drops stale ones', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watcher = yield* startWatcher(sessionA);
        // Baseline was -1 at proposal; version 5 projects.
        yield* watcher.remoteStream(remoteStreamHandle, 5);
        assert.deepInclude(watcher.events, {
          _tag: 'WatchProgramStreamReady',
          stream: remoteStreamHandle,
        });

        const before = watcher.events.length;
        // A stale version never re-projects.
        yield* watcher.remoteStream({ value: { id: 'stale' } }, 3);
        assert.strictEqual(watcher.events.length, before);

        // A newer clear projects a cleared event.
        yield* watcher.remoteStream(null, 6);
        assert.deepInclude(watcher.events.slice(before), { _tag: 'WatchProgramStreamCleared' });
      }),
    ),
  );
});

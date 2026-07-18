import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import { WatchSessionId, type WatchMessage, type WatchProposed } from './Protocol';
import { makeWatchActorTestHarness } from './test/WatchActorTestHarness';

type Harness = Effect.Success<ReturnType<typeof makeWatchActorTestHarness>>;

const proposedId = (sent: ReadonlyArray<WatchMessage>): WatchSessionId => {
  const message = sent.find((m): m is WatchProposed => m.type === 'watch-proposed');
  assert.isDefined(message);
  return (message as WatchProposed).watchSessionId;
};

// A presenter (host) and watcher (guest) driven to a shared loaded-paused
// session over a fixed id, piping the relevant messages by hand.
const connectPair = Effect.fnUntraced(function* () {
  const presenter = yield* makeWatchActorTestHarness({ role: 'host' });
  const watcher = yield* makeWatchActorTestHarness({ role: 'guest' });
  yield* presenter.openChannel();
  yield* presenter.receiveHello();
  yield* watcher.openChannel();
  yield* watcher.receiveHello();

  yield* presenter.propose();
  const id = proposedId(presenter.sent);
  yield* watcher.peerProposes(id);
  yield* presenter.receiveReady(id);
  const started = presenter.sent.filter((m) => m.type === 'playback-state-changed');
  yield* watcher.receiveStarted(id);
  yield* watcher.receiveCanonical(id, {
    authorityEpoch: 0,
    revision: 0,
    status: 'loaded-paused',
    progress: 0,
  });
  assert.strictEqual(started.length, 1);
  return { presenter, watcher, id };
});

// Feeds the newest canonical the presenter broadcast into the watcher.
const relayCanonical = Effect.fnUntraced(function* (
  presenter: Harness,
  watcher: Harness,
  id: WatchSessionId,
) {
  const canonical = presenter.sent.filter((m) => m.type === 'playback-state-changed').at(-1);
  assert.isDefined(canonical);
  const c = canonical as Extract<WatchMessage, { type: 'playback-state-changed' }>;
  yield* watcher.receiveCanonical(id, {
    authorityEpoch: c.authorityEpoch,
    revision: c.revision,
    status: c.status,
    progress: c.progress,
    reason: c.reason,
  });
});

describe('watch actor — playback authority and progress', () => {
  it.effect('converges presenter and watcher through play, pause, seek', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { presenter, watcher, id } = yield* connectPair();

        yield* presenter.requestControl({ kind: 'play' });
        yield* relayCanonical(presenter, watcher, id);
        assert.strictEqual(presenter.lastView()?.status, 'playing');
        assert.strictEqual(watcher.lastView()?.status, 'playing');

        yield* presenter.requestControl({ kind: 'pause' });
        yield* relayCanonical(presenter, watcher, id);
        assert.strictEqual(presenter.lastView()?.status, 'loaded-paused');
        assert.strictEqual(watcher.lastView()?.status, 'loaded-paused');

        yield* presenter.requestControl({ kind: 'seek', target: 0.5 });
        yield* relayCanonical(presenter, watcher, id);
        assert.strictEqual(presenter.lastView()?.progress, 0.5);
        assert.strictEqual(watcher.lastView()?.progress, 0.5);
        assert.deepInclude(presenter.operations, 'seek:0.5');
      }),
    ),
  );

  it.effect('converges through replay from ended', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { presenter, watcher, id } = yield* connectPair();
        yield* presenter.requestControl({ kind: 'play' });
        yield* presenter.sourceEvent({ _tag: 'SourceEnded' });
        yield* relayCanonical(presenter, watcher, id);
        assert.strictEqual(presenter.lastView()?.status, 'ended');
        assert.strictEqual(watcher.lastView()?.status, 'ended');

        yield* presenter.requestControl({ kind: 'replay' });
        yield* relayCanonical(presenter, watcher, id);
        assert.strictEqual(presenter.lastView()?.status, 'playing');
        assert.strictEqual(presenter.lastView()?.progress, 0);
        assert.strictEqual(watcher.lastView()?.status, 'playing');
      }),
    ),
  );

  it.effect('ejects: presenter clears source and both return to idle', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { presenter, watcher, id } = yield* connectPair();

        yield* presenter.requestControl({ kind: 'eject' });

        assert.deepStrictEqual(presenter.lastSent(), {
          version: 1,
          type: 'watch-ended',
          watchSessionId: id,
        });
        assert.deepInclude(presenter.operations, 'closeSourceScope');
        assert.strictEqual(presenter.lastView()?.status, 'idle');

        yield* watcher.receiveEnded(id);
        assert.strictEqual(watcher.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('applies watcher control optimistically then reconciles', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { presenter, watcher, id } = yield* connectPair();

        yield* watcher.requestControl({ kind: 'play' });
        // Optimistic move before confirmation.
        assert.strictEqual(watcher.lastView()?.status, 'playing');
        const request = watcher.lastSent();
        assert.deepStrictEqual(request, {
          version: 1,
          type: 'control-requested',
          watchSessionId: id,
          authorityEpoch: 0,
          baseRevision: 0,
          control: { kind: 'play' },
        });

        yield* presenter.receive(request as WatchMessage);
        yield* relayCanonical(presenter, watcher, id);
        assert.strictEqual(presenter.lastView()?.status, 'playing');
        assert.strictEqual(watcher.lastView()?.status, 'playing');
      }),
    ),
  );

  it.effect('rolls a rejected optimistic control back to the confirmed state', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { watcher, id } = yield* connectPair();

        yield* watcher.requestControl({ kind: 'play' });
        assert.strictEqual(watcher.lastView()?.status, 'playing');

        yield* watcher.receive({
          version: 1,
          type: 'control-rejected',
          watchSessionId: id,
          authorityEpoch: 0,
          baseRevision: 0,
        });
        assert.strictEqual(watcher.lastView()?.status, 'loaded-paused');
      }),
    ),
  );

  it.effect('rejects a control request issued against a stale revision', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { presenter, id } = yield* connectPair();
        yield* presenter.requestControl({ kind: 'play' }); // revision is now 1

        yield* presenter.receive({
          version: 1,
          type: 'control-requested',
          watchSessionId: id,
          authorityEpoch: 0,
          baseRevision: 0,
          control: { kind: 'pause' },
        });

        assert.deepStrictEqual(presenter.lastSent(), {
          version: 1,
          type: 'control-rejected',
          watchSessionId: id,
          authorityEpoch: 0,
          baseRevision: 1,
        });
        assert.strictEqual(presenter.lastView()?.status, 'playing');
      }),
    ),
  );

  it.effect('ignores stale sessions, revisions, and sequences on the watcher', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { presenter, watcher, id } = yield* connectPair();
        yield* presenter.requestControl({ kind: 'play' });
        yield* relayCanonical(presenter, watcher, id); // watcher playing at revision 1

        const viewsBefore = watcher.sessionViews().length;
        // Old revision, wrong session, and a stale sample are all ignored.
        yield* watcher.receiveCanonical(id, {
          authorityEpoch: 0,
          revision: 0,
          status: 'loaded-paused',
          progress: 0.9,
        });
        yield* watcher.receiveCanonical(WatchSessionId.make('watch-zzzz-99'), {
          authorityEpoch: 0,
          revision: 5,
          status: 'ended',
          progress: 1,
        });
        yield* watcher.receive({
          version: 1,
          type: 'progress-sample',
          watchSessionId: id,
          authorityEpoch: 0,
          revision: 0,
          sequence: 0,
          progress: 0.7,
        });
        assert.strictEqual(watcher.sessionViews().length, viewsBefore);

        // A fresh sample for the current revision is applied.
        yield* watcher.receive({
          version: 1,
          type: 'progress-sample',
          watchSessionId: id,
          authorityEpoch: 0,
          revision: 1,
          sequence: 3,
          progress: 0.4,
        });
        assert.strictEqual(watcher.lastView()?.progress, 0.4);
        // A now-stale sequence is dropped.
        yield* watcher.receive({
          version: 1,
          type: 'progress-sample',
          watchSessionId: id,
          authorityEpoch: 0,
          revision: 1,
          sequence: 2,
          progress: 0.99,
        });
        assert.strictEqual(watcher.lastView()?.progress, 0.4);
      }),
    ),
  );

  it.effect('emits bounded coalesced samples while playing', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const presenter = yield* makeWatchActorTestHarness({ role: 'host', currentProgress: 0.3 });
        yield* presenter.openChannel();
        yield* presenter.receiveHello();
        yield* presenter.propose();
        const id = proposedId(presenter.sent);
        yield* presenter.receiveReady(id);
        yield* presenter.requestControl({ kind: 'play' });

        yield* presenter.advance('500 millis');
        yield* presenter.advance('500 millis');
        assert.deepStrictEqual(
          presenter.progressOffers.map((s) => s.sequence),
          [0, 1],
        );
        assert.strictEqual(presenter.pendingProgress()?.progress, 0.3);

        // A discrete pause flushes the pending sample and takes priority.
        yield* presenter.requestControl({ kind: 'pause' });
        assert.isNull(presenter.pendingProgress());
        assert.strictEqual(presenter.lastSent()?.type, 'playback-state-changed');
      }),
    ),
  );

  it.effect('emits an optimistic view for every watcher control kind', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { watcher, id } = yield* connectPair();

        yield* watcher.requestControl({ kind: 'pause' });
        assert.strictEqual(watcher.lastView()?.status, 'loaded-paused');

        yield* watcher.requestControl({ kind: 'seek', target: 0.3 });
        assert.strictEqual(watcher.lastView()?.progress, 0.3);

        yield* watcher.requestControl({ kind: 'replay' });
        assert.strictEqual(watcher.lastView()?.status, 'playing');
        assert.strictEqual(watcher.lastView()?.progress, 0);

        const viewsBefore = watcher.sessionViews().length;
        yield* watcher.requestControl({ kind: 'eject' });
        // Eject has no optimistic view; only the request is sent.
        assert.strictEqual(watcher.sessionViews().length, viewsBefore);
        assert.deepStrictEqual(watcher.lastSent(), {
          version: 1,
          type: 'control-requested',
          watchSessionId: id,
          authorityEpoch: 0,
          baseRevision: 0,
          control: { kind: 'eject' },
        });
      }),
    ),
  );

  it.effect('rejects invalid presenter transitions and seeks while playing', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { presenter: h } = yield* connectPair();
        yield* h.requestControl({ kind: 'play' }); // Playing, revision 1

        // Invalid while playing: play again and replay are no-ops.
        const revAfterPlay = h.lastView()?.revision;
        yield* h.requestControl({ kind: 'play' });
        yield* h.requestControl({ kind: 'replay' });
        assert.strictEqual(h.lastView()?.revision, revAfterPlay);

        // Seek while playing stays playing at the new position.
        yield* h.requestControl({ kind: 'seek', target: 0.4 });
        assert.strictEqual(h.lastView()?.status, 'playing');
        assert.strictEqual(h.lastView()?.progress, 0.4);

        // Buffering rejects a seek; pause is invalid once loaded-paused.
        yield* h.sourceEvent({ _tag: 'SourceBuffering' });
        const revBuffering = h.lastView()?.revision;
        yield* h.requestControl({ kind: 'seek', target: 0.6 });
        assert.strictEqual(h.lastView()?.revision, revBuffering);

        yield* h.sourceEvent({ _tag: 'SourcePlaying' });
        yield* h.requestControl({ kind: 'pause' }); // loaded-paused
        const revPaused = h.lastView()?.revision;
        yield* h.requestControl({ kind: 'pause' });
        assert.strictEqual(h.lastView()?.revision, revPaused);
      }),
    ),
  );

  it.effect('ignores misrouted control and sample messages', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { presenter, watcher, id } = yield* connectPair();
        yield* presenter.requestControl({ kind: 'play' });
        yield* relayCanonical(presenter, watcher, id); // watcher playing at revision 1

        // A presenter ignores a stray control-rejected and progress-sample.
        const presenterViews = presenter.sessionViews().length;
        yield* presenter.receive({
          version: 1,
          type: 'control-rejected',
          watchSessionId: id,
          authorityEpoch: 0,
          baseRevision: 1,
        });
        yield* presenter.receive({
          version: 1,
          type: 'progress-sample',
          watchSessionId: id,
          authorityEpoch: 0,
          revision: 1,
          sequence: 0,
          progress: 0.5,
        });
        assert.strictEqual(presenter.sessionViews().length, presenterViews);

        // A watcher ignores a control-requested meant for a presenter.
        const watcherViews = watcher.sessionViews().length;
        yield* watcher.receive({
          version: 1,
          type: 'control-requested',
          watchSessionId: id,
          authorityEpoch: 0,
          baseRevision: 1,
          control: { kind: 'pause' },
        });
        assert.strictEqual(watcher.sessionViews().length, watcherViews);
      }),
    ),
  );

  it.effect('ignores control requests with no active session', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness();
        yield* h.openChannel();
        yield* h.receiveHello();
        const sentBefore = h.sent.length;

        yield* h.requestControl({ kind: 'play' });

        assert.strictEqual(h.sent.length, sentBefore);
        assert.strictEqual(h.lastView()?.status, 'idle');
      }),
    ),
  );

  it.effect('reflects source progress only while playing', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const presenter = yield* makeWatchActorTestHarness({ role: 'host' });
        yield* presenter.openChannel();
        yield* presenter.receiveHello();
        yield* presenter.propose();
        const id = proposedId(presenter.sent);
        yield* presenter.receiveReady(id);

        // Loaded-paused: a stray progress event is ignored.
        const views = presenter.sessionViews().length;
        yield* presenter.sourceEvent({ _tag: 'SourceProgress', progress: 0.2 });
        assert.strictEqual(presenter.sessionViews().length, views);

        yield* presenter.requestControl({ kind: 'play' });
        yield* presenter.sourceEvent({ _tag: 'SourceProgress', progress: 0.6 });
        assert.strictEqual(presenter.lastView()?.progress, 0.6);
      }),
    ),
  );

  it.effect('arms at most one sampling tick even when progress reads block', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const presenter = yield* makeWatchActorTestHarness({
          role: 'host',
          overrides: { currentProgress: () => Effect.never },
        });
        yield* presenter.openChannel();
        yield* presenter.receiveHello();
        yield* presenter.propose();
        const id = proposedId(presenter.sent);
        yield* presenter.receiveReady(id);
        yield* presenter.requestControl({ kind: 'play' });

        yield* presenter.advance('500 millis'); // one tick fires and blocks
        yield* presenter.advance('500 millis'); // no second tick is queued
        assert.deepStrictEqual(presenter.progressOffers, []);
      }),
    ),
  );
});

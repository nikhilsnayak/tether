import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import type { WatchSessionView } from './Model';
import { WatchSessionId, type WatchMessage, type WatchProposed } from './Protocol';
import { WatchPlatformError } from './Services';
import {
  makeWatchActorTestHarness,
  programStreamHandle,
  remoteStreamHandle,
  type WatchHarnessOptions,
} from './test/WatchActorTestHarness';

const sessionA = WatchSessionId.make('watch-aaaa-01');
const sessionB = WatchSessionId.make('watch-bbbb-02');

const presenterLoadedPaused: WatchSessionView = {
  status: 'loaded-paused',
  role: 'presenter',
  progress: 0,
  revision: 0,
  controlsEnabled: true,
  canPresent: false,
  bufferingReason: null,
};
const watcherLoadedPaused: WatchSessionView = { ...presenterLoadedPaused, role: 'watcher' };
const awaitingRemoteStart: WatchSessionView = {
  status: 'awaiting-remote-start',
  role: 'watcher',
  progress: 0,
  revision: 0,
  controlsEnabled: false,
  canPresent: false,
  bufferingReason: null,
};
const idleView: WatchSessionView = {
  status: 'idle',
  role: null,
  progress: 0,
  revision: 0,
  controlsEnabled: false,
  canPresent: true,
  bufferingReason: null,
};

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

describe('watch actor — startup and arbitration', () => {
  it.effect('presents an uncontested local source (host)', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h, id } = yield* startPresenter();

        assert.deepStrictEqual(h.operations, [
          'claimSource',
          'observeSource',
          'programStream',
          'attachProgramTracks',
          'primeFirstFrame',
        ]);
        assert.deepStrictEqual(
          h.sent.map((m) => m.type),
          ['hello', 'watch-proposed', 'watch-started', 'playback-state-changed'],
        );
        assert.deepStrictEqual(h.sent[3], {
          version: 1,
          type: 'playback-state-changed',
          watchSessionId: id,
          authorityEpoch: 0,
          revision: 0,
          status: 'loaded-paused',
          progress: 0,
        });
        assert.deepInclude(h.events, {
          _tag: 'WatchProgramStreamReady',
          stream: programStreamHandle,
        });
        assert.deepStrictEqual(h.lastView(), presenterLoadedPaused);
      }),
    ),
  );

  it.effect('presents an uncontested local source (guest)', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenter({ role: 'guest' });

        assert.deepInclude(h.operations, 'claimSource');
        assert.deepStrictEqual(h.lastView(), presenterLoadedPaused);
      }),
    ),
  );

  it.effect('becomes a watcher only after started and initial canonical state', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness();
        yield* h.openChannel();
        yield* h.receiveHello();

        yield* h.peerProposes(sessionA);
        assert.deepStrictEqual(h.lastSent(), {
          version: 1,
          type: 'watch-ready',
          watchSessionId: sessionA,
        });
        assert.deepStrictEqual(h.lastView(), awaitingRemoteStart);

        // Canonical before started is ignored; the view stays awaiting.
        yield* h.receiveCanonical(sessionA, {
          authorityEpoch: 0,
          revision: 0,
          status: 'loaded-paused',
          progress: 0,
        });
        assert.deepStrictEqual(h.lastView(), awaitingRemoteStart);

        yield* h.receiveStarted(sessionA);
        yield* h.receiveCanonical(sessionA, {
          authorityEpoch: 0,
          revision: 0,
          status: 'loaded-paused',
          progress: 0,
        });
        assert.deepStrictEqual(h.lastView(), watcherLoadedPaused);
      }),
    ),
  );

  it.effect('projects a post-proposal program stream but not a pre-proposal one', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fresh = yield* makeWatchActorTestHarness();
        yield* fresh.openChannel();
        yield* fresh.receiveHello();
        // Stream that arrives before the proposal must never project into the session.
        yield* fresh.remoteStream(remoteStreamHandle, 0);
        yield* fresh.peerProposes(sessionA);
        yield* fresh.receiveStarted(sessionA);
        yield* fresh.receiveCanonical(sessionA, {
          authorityEpoch: 0,
          revision: 0,
          status: 'loaded-paused',
          progress: 0,
        });
        assert.notDeepInclude(fresh.events, {
          _tag: 'WatchProgramStreamReady',
          stream: remoteStreamHandle,
        });

        const late = yield* makeWatchActorTestHarness();
        yield* late.openChannel();
        yield* late.receiveHello();
        yield* late.peerProposes(sessionA);
        yield* late.remoteStream(remoteStreamHandle, 1);
        yield* late.receiveStarted(sessionA);
        yield* late.receiveCanonical(sessionA, {
          authorityEpoch: 0,
          revision: 0,
          status: 'loaded-paused',
          progress: 0,
        });
        assert.deepInclude(late.events, {
          _tag: 'WatchProgramStreamReady',
          stream: remoteStreamHandle,
        });
      }),
    ),
  );

  it.effect('resolves overlapping proposals in the host favor', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* makeWatchActorTestHarness({ role: 'host' });
        yield* host.openChannel();
        yield* host.receiveHello();
        yield* host.propose();
        const hostId = proposedId(host.sent);
        yield* host.peerProposes(sessionA);
        assert.deepStrictEqual(host.lastSent(), {
          version: 1,
          type: 'watch-rejected',
          watchSessionId: sessionA,
          reason: 'lost-arbitration',
        });
        yield* host.receiveReady(hostId);
        assert.deepInclude(host.operations, 'claimSource');

        const guest = yield* makeWatchActorTestHarness({ role: 'guest' });
        yield* guest.openChannel();
        yield* guest.receiveHello();
        yield* guest.propose();
        const guestId = proposedId(guest.sent);
        yield* guest.peerProposes(sessionA);
        assert.deepInclude(guest.operations, 'cancelPreparedSource');
        assert.deepStrictEqual(guest.lastSent(), {
          version: 1,
          type: 'watch-ready',
          watchSessionId: sessionA,
        });
        // A late ready for the guest's dead proposal is ignored by session ID.
        const before = guest.operations.length;
        yield* guest.receiveReady(guestId);
        assert.strictEqual(guest.operations.length, before);
      }),
    ),
  );

  it.effect('rejects a new proposal as busy while a session is active', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { h } = yield* startPresenter();

        yield* h.peerProposes(sessionB);

        assert.deepStrictEqual(h.lastSent(), {
          version: 1,
          type: 'watch-rejected',
          watchSessionId: sessionB,
          reason: 'busy',
        });
      }),
    ),
  );

  it.effect('releases the prepared source once when claiming fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness({
          overrides: {
            claimSource: () =>
              Effect.fail(new WatchPlatformError({ operation: 'claim-source', cause: 'boom' })),
          },
        });
        yield* h.openChannel();
        yield* h.receiveHello();
        yield* h.propose();
        const id = proposedId(h.sent);

        yield* h.receiveReady(id);

        assert.deepStrictEqual(
          h.operations.filter((op) => op === 'cancelPreparedSource'),
          ['cancelPreparedSource'],
        );
        assert.deepStrictEqual(h.lastSent(), {
          version: 1,
          type: 'watch-failed',
          watchSessionId: id,
          reason: 'attachment',
        });
        assert.deepInclude(h.events, { _tag: 'WatchFailed', reason: 'attachment' });
        assert.deepStrictEqual(h.lastView(), idleView);
      }),
    ),
  );

  it.effect('rolls back both tracks and the source when attachment fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeWatchActorTestHarness({
          overrides: {
            attachProgramTracks: () =>
              Effect.fail(
                new WatchPlatformError({ operation: 'attach-program-tracks', cause: 'boom' }),
              ),
          },
        });
        yield* h.openChannel();
        yield* h.receiveHello();
        yield* h.propose();
        const id = proposedId(h.sent);

        yield* h.receiveReady(id);

        assert.deepStrictEqual(h.operations, [
          'claimSource',
          'observeSource',
          'programStream',
          'clearProgramTracks',
          'unobserveSource',
          'closeSourceScope',
        ]);
        assert.deepStrictEqual(h.lastView(), idleView);
        // The actor survives and can propose a second source.
        yield* h.propose();
        assert.strictEqual(h.lastSent()?.type, 'watch-proposed');
      }),
    ),
  );

  it.effect('cancels an ownership-bearing proposal delivered outside idle', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const unavailable = yield* makeWatchActorTestHarness();
        yield* unavailable.propose();
        assert.deepStrictEqual(unavailable.operations, ['cancelPreparedSource']);
        assert.deepStrictEqual(unavailable.sent, []);

        const cannotPresent = yield* makeWatchActorTestHarness({
          capabilities: { canPresentLocalFile: false },
        });
        yield* cannotPresent.openChannel();
        yield* cannotPresent.receiveHello({ canPresentLocalFile: true });
        yield* cannotPresent.propose();
        assert.deepInclude(cannotPresent.operations, 'cancelPreparedSource');
        assert.isUndefined(cannotPresent.sent.find((m) => m.type === 'watch-proposed'));

        const active = (yield* startPresenter()).h;
        const before = active.operations.length;
        yield* active.propose();
        assert.deepStrictEqual(active.operations.slice(before), ['cancelPreparedSource']);
      }),
    ),
  );

  it.effect('cancels a preparing proposal on local cancel or remote rejection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cancelled = yield* makeWatchActorTestHarness();
        yield* cancelled.openChannel();
        yield* cancelled.receiveHello();
        yield* cancelled.propose();
        yield* cancelled.cancelPreparing();
        assert.deepInclude(cancelled.operations, 'cancelPreparedSource');
        assert.deepStrictEqual(cancelled.lastView(), idleView);

        const rejected = yield* makeWatchActorTestHarness();
        yield* rejected.openChannel();
        yield* rejected.receiveHello();
        yield* rejected.propose();
        const id = proposedId(rejected.sent);
        yield* rejected.receiveRejected(id, 'busy');
        assert.deepInclude(rejected.operations, 'cancelPreparedSource');
        assert.deepStrictEqual(rejected.lastView(), idleView);
      }),
    ),
  );
});

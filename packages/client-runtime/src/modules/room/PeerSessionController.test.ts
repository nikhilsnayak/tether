import { assert, describe, it } from '@effect/vitest';
import { PeerId } from '@tether/contracts/modules/room';
import { Effect, Exit, Scope } from 'effect';

import {
  makePeerSessionControllerBinding,
  PeerSessionControllerAlreadyActive,
  PeerSessionUnavailableError,
} from './PeerSessionController';
import type { PeerSession } from './PeerSessionHost';

const peerId = PeerId.make('bbbbbbbbbbbb');
const pose = { x: 1, z: 2, yaw: 0, action: 'walk' } as const;
const mediaState = { cameraOn: true, microphoneOn: false } as const;
const watchSource = { value: { id: 'prepared' } };
const watchControl = { kind: 'play' } as const;

const flushNotifications = Effect.promise(() => Promise.resolve());

const makeSession = (queued = true) => {
  const calls: Array<unknown> = [];
  const session: PeerSession = {
    sendMessage: (message) => {
      calls.push(['sendMessage', message]);
      return queued;
    },
    sendAvatarPose: (value) => {
      calls.push(['sendAvatarPose', value]);
      return queued;
    },
    sendMediaState: (value) => {
      calls.push(['sendMediaState', value]);
      return queued;
    },
    watch: {
      propose: (source) => {
        calls.push(['watch.propose', source]);
        return queued;
      },
      control: (control) => {
        calls.push(['watch.control', control]);
        return queued;
      },
      cancel: () => {
        calls.push(['watch.cancel']);
        return queued;
      },
    },
    respondToJoin: async (id, decision) => {
      calls.push(['respondToJoin', id, decision]);
    },
    leave: async () => {
      calls.push(['leave']);
    },
  };
  return { calls, session };
};

describe('PeerSessionController', () => {
  it('reports unavailable commands while inactive', async () => {
    const { controller, getSnapshot } = makePeerSessionControllerBinding();

    assert.isFalse(getSnapshot());
    assert.isFalse(controller.isActive());
    assert.strictEqual(controller.sendMessage('hello'), 'unavailable');
    assert.strictEqual(controller.sendAvatarPose(pose), 'unavailable');
    assert.strictEqual(controller.sendMediaState(mediaState), 'unavailable');
    assert.strictEqual(controller.watch.propose(watchSource), 'unavailable');
    assert.strictEqual(controller.watch.control(watchControl), 'unavailable');
    assert.strictEqual(controller.watch.cancel(), 'unavailable');
    const respondToJoinError = await controller.respondToJoin(peerId, 'allow').then(
      () => null,
      (error: unknown) => error,
    );
    const leaveError = await controller.leave().then(
      () => null,
      (error: unknown) => error,
    );
    assert.instanceOf(respondToJoinError, PeerSessionUnavailableError);
    assert.instanceOf(leaveError, PeerSessionUnavailableError);
  });

  it.effect('forwards all commands while active and maps send results', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const binding = makePeerSessionControllerBinding();
      const fixture = makeSession();

      yield* binding.activate(fixture.session).pipe(Scope.provide(scope));
      assert.isTrue(binding.controller.isActive());
      assert.strictEqual(binding.controller.sendMessage('hello'), 'queued');
      assert.strictEqual(binding.controller.sendAvatarPose(pose), 'queued');
      assert.strictEqual(binding.controller.sendMediaState(mediaState), 'queued');
      assert.strictEqual(binding.controller.watch.propose(watchSource), 'queued');
      assert.strictEqual(binding.controller.watch.control(watchControl), 'queued');
      assert.strictEqual(binding.controller.watch.cancel(), 'queued');
      yield* Effect.promise(() => binding.controller.respondToJoin(peerId, 'deny'));
      yield* Effect.promise(() => binding.controller.leave());
      assert.deepStrictEqual(fixture.calls, [
        ['sendMessage', 'hello'],
        ['sendAvatarPose', pose],
        ['sendMediaState', mediaState],
        ['watch.propose', watchSource],
        ['watch.control', watchControl],
        ['watch.cancel'],
        ['respondToJoin', peerId, 'deny'],
        ['leave'],
      ]);

      yield* Scope.close(scope, Exit.void);
      assert.isFalse(binding.controller.isActive());
    }),
  );

  it.effect('maps a closed underlying session to closed', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const binding = makePeerSessionControllerBinding();
        const fixture = makeSession(false);

        yield* binding.activate(fixture.session);
        assert.strictEqual(binding.controller.sendMessage('hello'), 'closed');
      }),
    ),
  );

  it.effect('keeps the first session active when overlapping activation fails', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const binding = makePeerSessionControllerBinding();
      const first = makeSession();
      const second = makeSession();
      const snapshots: Array<boolean> = [];
      binding.subscribe(() => snapshots.push(binding.getSnapshot()));

      yield* binding.activate(first.session).pipe(Scope.provide(scope));
      const error = yield* binding.activate(second.session).pipe(Effect.flip, Scope.provide(scope));
      assert.instanceOf(error, PeerSessionControllerAlreadyActive);
      yield* flushNotifications;
      assert.deepStrictEqual(snapshots, [true]);
      assert.strictEqual(binding.controller.sendMessage('still first'), 'queued');
      assert.deepStrictEqual(first.calls, [['sendMessage', 'still first']]);
      assert.deepStrictEqual(second.calls, []);

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect('updates the snapshot synchronously and notifies on a microtask', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const binding = makePeerSessionControllerBinding();
      const snapshots: Array<boolean> = [];
      binding.subscribe(() => snapshots.push(binding.getSnapshot()));

      yield* binding.activate(makeSession().session).pipe(Scope.provide(scope));
      assert.isTrue(binding.getSnapshot());
      assert.deepStrictEqual(snapshots, []);
      yield* flushNotifications;
      assert.deepStrictEqual(snapshots, [true]);

      yield* Scope.close(scope, Exit.void);
      assert.isFalse(binding.getSnapshot());
      yield* flushNotifications;
      assert.deepStrictEqual(snapshots, [true, false]);
    }),
  );

  it.effect('coalesces publishes within one microtask into a single notification', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const binding = makePeerSessionControllerBinding();
      const snapshots: Array<boolean> = [];
      binding.subscribe(() => snapshots.push(binding.getSnapshot()));

      yield* binding.activate(makeSession().session).pipe(Scope.provide(scope));
      yield* Scope.close(scope, Exit.void);
      yield* flushNotifications;

      assert.deepStrictEqual(snapshots, [false]);
    }),
  );

  it.effect('does not notify an unsubscribed listener', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const binding = makePeerSessionControllerBinding();
      const snapshots: Array<boolean> = [];
      const unsubscribe = binding.subscribe(() => snapshots.push(binding.getSnapshot()));

      unsubscribe();
      unsubscribe();
      yield* binding.activate(makeSession().session).pipe(Scope.provide(scope));
      yield* Scope.close(scope, Exit.void);
      yield* flushNotifications;

      assert.deepStrictEqual(snapshots, []);
    }),
  );

  it.effect('reuses one binding across sequential sessions without changing identity', () =>
    Effect.gen(function* () {
      const binding = makePeerSessionControllerBinding();
      const controller = binding.controller;
      const snapshots: Array<boolean> = [];
      binding.subscribe(() => snapshots.push(binding.getSnapshot()));

      const firstScope = yield* Scope.make();
      yield* binding.activate(makeSession().session).pipe(Scope.provide(firstScope));
      yield* flushNotifications;
      yield* Scope.close(firstScope, Exit.void);
      yield* flushNotifications;

      const secondScope = yield* Scope.make();
      yield* binding.activate(makeSession().session).pipe(Scope.provide(secondScope));
      yield* flushNotifications;
      yield* Scope.close(secondScope, Exit.void);
      yield* flushNotifications;

      assert.strictEqual(binding.controller, controller);
      assert.deepStrictEqual(snapshots, [true, false, true, false]);
    }),
  );

  it('creates a unique binding and controller for each owner', () => {
    const first = makePeerSessionControllerBinding();
    const second = makePeerSessionControllerBinding();

    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first.controller, second.controller);
  });
});

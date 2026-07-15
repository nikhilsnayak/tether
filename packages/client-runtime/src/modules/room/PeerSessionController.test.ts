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
    const { controller } = makePeerSessionControllerBinding();

    assert.isFalse(controller.isActive());
    assert.strictEqual(controller.sendMessage('hello'), 'unavailable');
    assert.strictEqual(controller.sendAvatarPose(pose), 'unavailable');
    assert.strictEqual(controller.sendMediaState(mediaState), 'unavailable');
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
      yield* Effect.promise(() => binding.controller.respondToJoin(peerId, 'deny'));
      yield* Effect.promise(() => binding.controller.leave());
      assert.deepStrictEqual(fixture.calls, [
        ['sendMessage', 'hello'],
        ['sendAvatarPose', pose],
        ['sendMediaState', mediaState],
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

      yield* binding.activate(first.session).pipe(Scope.provide(scope));
      const error = yield* binding.activate(second.session).pipe(Effect.flip, Scope.provide(scope));
      assert.instanceOf(error, PeerSessionControllerAlreadyActive);
      assert.strictEqual(binding.controller.sendMessage('still first'), 'queued');
      assert.deepStrictEqual(first.calls, [['sendMessage', 'still first']]);
      assert.deepStrictEqual(second.calls, []);

      yield* Scope.close(scope, Exit.void);
    }),
  );
});

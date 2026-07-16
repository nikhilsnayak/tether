import { assert } from '@effect/vitest';
import {
  DUSK_SUITE_TEMPLATE_ID,
  DisplayName,
  JoinRequestedEvent,
  PeerId,
  RoomEvent,
  RoomId,
  RoomRpcs,
  RoomSignalingRpcs,
  RoomSessionOpenedEvent,
  SessionToken,
} from '@tether/contracts/modules/room';
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from 'effect';
import { RpcTest } from 'effect/unstable/rpc';

import * as ServerCrypto from '../../../lib/ServerCrypto';
import { RoomHandlers, RoomSignalingHandlers } from '../Handlers';
import { RoomService } from '../RoomService';

const alice = PeerId.make('aaaaaaaaaaaa');
const bob = PeerId.make('bbbbbbbbbbbb');
const bobName = DisplayName.make('Bob');

const TestHandlers = Layer.mergeAll(RoomHandlers, RoomSignalingHandlers).pipe(
  Layer.provide(RoomService.layer),
  Layer.provide(ServerCrypto.layer),
);
const makeRoomRpcClients = Effect.all({
  client: RpcTest.makeClient(RoomSignalingRpcs),
  metadataClient: RpcTest.makeClient(RoomRpcs),
}).pipe(Effect.provide(TestHandlers));

const isJoinRequestedEvent = Schema.is(JoinRequestedEvent);
const isRoomSessionOpenedEvent = Schema.is(RoomSessionOpenedEvent);

export const makeRoomRpcTestHarness = Effect.fn('makeRoomRpcTestHarness')(function* () {
  const { client, metadataClient } = yield* makeRoomRpcClients;
  const connect = Effect.fn('RoomRpcTestHarness.connect')(function* (
    options: { readonly hostTake?: number; readonly joinerTake?: number } = {},
  ) {
    const roomIdDeferred = yield* Deferred.make<RoomId>();
    const aliceTokenDeferred = yield* Deferred.make<SessionToken>();
    const knockDeferred = yield* Deferred.make<void>();
    const bobTokenDeferred = yield* Deferred.make<SessionToken>();

    const hostStream = client.OpenRoomSession({
      selfId: alice,
      intent: 'host',
      roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
    });
    const aliceFiber = yield* (
      options.hostTake === undefined
        ? hostStream.pipe(Stream.tap(hostTap), Stream.runDrain)
        : hostStream.pipe(Stream.tap(hostTap), Stream.take(options.hostTake), Stream.runCollect)
    ).pipe(Effect.forkChild({ startImmediately: true }));

    const roomId = yield* Deferred.await(roomIdDeferred);
    const aliceToken = yield* Deferred.await(aliceTokenDeferred);
    assert.deepStrictEqual(yield* metadataClient.GetRoomMetadata({ roomId }), {
      roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
    });

    const joinStream = client.OpenRoomSession({
      selfId: bob,
      intent: 'join',
      roomId,
      displayName: bobName,
    });
    const bobFiber = yield* (
      options.joinerTake === undefined
        ? joinStream.pipe(Stream.tap(bobTap), Stream.runDrain)
        : joinStream.pipe(Stream.tap(bobTap), Stream.take(options.joinerTake), Stream.runCollect)
    ).pipe(Effect.forkChild({ startImmediately: true }));

    yield* Deferred.await(knockDeferred);
    yield* client.RespondToJoin({
      roomId,
      selfId: alice,
      sessionToken: aliceToken,
      peerId: bob,
      decision: 'allow',
    });
    const bobToken = yield* Deferred.await(bobTokenDeferred);

    return {
      roomId,
      aliceToken,
      bobToken,
      aliceFiber: aliceFiber as Fiber.Fiber<ReadonlyArray<{ readonly event: RoomEvent }>>,
      bobFiber,
    };

    function hostTap(entry: { readonly event: { readonly _tag: string } }) {
      if (isRoomSessionOpenedEvent(entry.event)) {
        return Effect.all([
          Deferred.succeed(roomIdDeferred, entry.event.roomId),
          Deferred.succeed(aliceTokenDeferred, entry.event.sessionToken),
        ]);
      }
      if (isJoinRequestedEvent(entry.event)) {
        return Deferred.succeed(knockDeferred, undefined);
      }
      return Effect.void;
    }

    function bobTap(entry: { readonly event: { readonly _tag: string } }) {
      return isRoomSessionOpenedEvent(entry.event)
        ? Deferred.succeed(bobTokenDeferred, entry.event.sessionToken)
        : Effect.void;
    }
  });

  return { client, connect, metadataClient };
});

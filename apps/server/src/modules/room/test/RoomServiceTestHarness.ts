import {
  DUSK_SUITE_TEMPLATE_ID,
  DisplayName,
  PeerId,
  RoomId,
  RoomSessionOpenedEvent,
} from '@tether/contracts/modules/room';
import { Deferred, Effect, Schema, Stream } from 'effect';

import { RoomService } from '../RoomService';

const alice = PeerId.make('aaaaaaaaaaaa');
const bob = PeerId.make('bbbbbbbbbbbb');
const bobName = DisplayName.make('Bob');

const isOpened = Schema.is(RoomSessionOpenedEvent);

const hostRoom = (room: RoomService['Service'], selfId: PeerId) =>
  room.host(selfId, DUSK_SUITE_TEMPLATE_ID);

export const makeRoomServiceTestHarness = Effect.fn('makeRoomServiceTestHarness')(function* () {
  const room = yield* RoomService;
  const openHostRoomId = Effect.fn('RoomServiceTestHarness.openHostRoomId')(function* (
    self: PeerId,
  ) {
    const roomIdDeferred = yield* Deferred.make<RoomId>();
    const stream = yield* hostRoom(room, self);
    yield* stream.pipe(
      Stream.tap((event) =>
        isOpened(event) ? Deferred.succeed(roomIdDeferred, event.roomId) : Effect.void,
      ),
      Stream.runDrain,
      Effect.forkChild({ startImmediately: true }),
    );
    return yield* Deferred.await(roomIdDeferred);
  });

  const connect = Effect.fn('RoomServiceTestHarness.connect')(function* (options: {
    readonly hostTake: number;
    readonly joinerTake: number;
  }) {
    const roomIdDeferred = yield* Deferred.make<RoomId>();
    const aliceTokenDeferred = yield* Deferred.make<string>();
    const bobTokenDeferred = yield* Deferred.make<string>();

    const aliceStream = yield* hostRoom(room, alice);
    const aliceFiber = yield* aliceStream.pipe(
      Stream.tap((event) =>
        isOpened(event)
          ? Effect.all([
              Deferred.succeed(roomIdDeferred, event.roomId),
              Deferred.succeed(aliceTokenDeferred, event.sessionToken),
            ])
          : Effect.void,
      ),
      Stream.take(options.hostTake),
      Stream.runCollect,
      Effect.forkChild({ startImmediately: true }),
    );

    const roomId = yield* Deferred.await(roomIdDeferred);
    const aliceToken = yield* Deferred.await(aliceTokenDeferred);

    const bobStream = yield* room.join(roomId, bob, bobName);
    const bobFiber = yield* bobStream.pipe(
      Stream.tap((event) =>
        isOpened(event) ? Deferred.succeed(bobTokenDeferred, event.sessionToken) : Effect.void,
      ),
      Stream.take(options.joinerTake),
      Stream.runCollect,
      Effect.forkChild({ startImmediately: true }),
    );

    yield* room.respondToJoin(roomId, alice, aliceToken, bob, 'allow');
    const bobToken = yield* Deferred.await(bobTokenDeferred);

    return { roomId, aliceToken, bobToken, aliceFiber, bobFiber };
  });

  return { room, openHostRoomId, connect } as const;
});

import { assert, describe, it } from '@effect/vitest';
import {
  PeerId,
  PeerAlreadyJoined,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomFull,
  RoomId,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { Effect, Exit, Stream } from 'effect';

import { RoomService } from './RoomService';

const roomId = RoomId.make('room-1');
const alice = PeerId.make('alice');
const bob = PeerId.make('bob');
const charlie = PeerId.make('charlie');

const withRoomService = <A, E, R>(effect: Effect.Effect<A, E, R | RoomService>) =>
  effect.pipe(Effect.provide(RoomService.layerTest));

describe('RoomService', () => {
  it.effect('returns the existing peer and rejects a third member', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;

        const first = yield* room.join(roomId, alice);
        const second = yield* room.join(roomId, bob);
        const error = yield* room.join(roomId, charlie).pipe(Effect.flip);
        const firstEvents = yield* first.pipe(Stream.take(1), Stream.runCollect);
        const secondEvents = yield* second.pipe(Stream.take(1), Stream.runCollect);

        assert.deepStrictEqual(firstEvents, [new PeerJoinedEvent({ peerId: bob })]);
        assert.deepStrictEqual(secondEvents, [new PeerJoinedEvent({ peerId: alice })]);
        assert.instanceOf(error, RoomFull);
        assert.strictEqual(error.roomId, roomId);
      }),
    ),
  );

  it.effect('keeps the two-member capacity invariant under concurrent joins', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const exits = yield* Effect.forEach(
          [alice, bob, charlie],
          (peerId) => room.join(roomId, peerId).pipe(Effect.exit),
          { concurrency: 'unbounded' },
        );

        assert.lengthOf(exits.filter(Exit.isSuccess), 2);
        assert.lengthOf(exits.filter(Exit.isFailure), 1);
      }),
    ),
  );

  it.effect('publishes lifecycle events and leaves when the join scope closes', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const events = yield* room.join(roomId, alice);
        yield* Effect.scoped(room.join(roomId, bob));
        const received = yield* events.pipe(Stream.take(2), Stream.runCollect);

        assert.deepStrictEqual(received, [
          new PeerJoinedEvent({ peerId: bob }),
          new PeerLeftEvent({ peerId: bob }),
        ]);
      }),
    ),
  );

  it.effect('rejects a duplicate peer before checking room capacity', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        yield* room.join(roomId, alice);
        yield* room.join(roomId, bob);

        const error = yield* room.join(roomId, alice).pipe(Effect.flip);

        assert.instanceOf(error, PeerAlreadyJoined);
        assert.strictEqual(error.roomId, roomId);
        assert.strictEqual(error.peerId, alice);
      }),
    ),
  );

  it.effect('relays room events to subscribers', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const events = yield* room.join(roomId, alice);
        yield* room.join(roomId, bob);
        const event = new SignalReceivedEvent({
          peerId: bob,
          signal: { type: 'offer', sdp: 'test-offer' },
        });

        yield* room.sendSignal(roomId, bob, event.signal);
        const received = yield* events.pipe(Stream.take(2), Stream.runCollect);

        assert.deepStrictEqual(received, [new PeerJoinedEvent({ peerId: bob }), event]);
      }),
    ),
  );

  it.effect('does not lose a signal published before the newcomer consumes', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        yield* room.join(roomId, alice);
        const bobEvents = yield* room.join(roomId, bob);

        const signal = new SignalReceivedEvent({
          peerId: alice,
          signal: { type: 'offer', sdp: 'immediate-offer' },
        });
        yield* room.sendSignal(roomId, alice, signal.signal);

        const received = yield* bobEvents.pipe(Stream.take(2), Stream.runCollect);

        assert.deepStrictEqual(received, [new PeerJoinedEvent({ peerId: alice }), signal]);
      }),
    ),
  );

  it.effect('removes an empty room', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        yield* Effect.scoped(room.join(roomId, alice));

        const error = yield* room
          .sendSignal(roomId, alice, { type: 'offer', sdp: 'missing-room' })
          .pipe(Effect.flip);
        yield* room.join(roomId, bob);

        assert.instanceOf(error, PeerNotInRoom);
        assert.strictEqual(error.roomId, roomId);
        assert.strictEqual(error.peerId, alice);
      }),
    ),
  );
});

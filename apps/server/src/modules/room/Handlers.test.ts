import { assert, describe, it } from '@effect/vitest';
import {
  PeerId,
  PeerAlreadyJoined,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomFull,
  RoomId,
  RoomRpcs,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { Effect, Fiber, Layer, Stream } from 'effect';
import { RpcTest } from 'effect/unstable/rpc';

import { RoomHandlers } from './Handlers';
import { RoomService } from './RoomService';

const roomId = RoomId.make('room-1');
const alice = PeerId.make('alice');
const bob = PeerId.make('bob');
const charlie = PeerId.make('charlie');
const mallory = PeerId.make('mallory');

const TestHandlers = RoomHandlers.pipe(Layer.provide(RoomService.layerTest));

const makeClient = RpcTest.makeClient(RoomRpcs).pipe(Effect.provide(TestHandlers));

describe('RoomHandlers', () => {
  it.effect('seeds the newcomer and leaves when its stream closes', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .JoinRoom({ roomId, selfId: alice })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }));

      const bobEvents = yield* client
        .JoinRoom({ roomId, selfId: bob })
        .pipe(Stream.take(1), Stream.runCollect);
      const aliceEvents = yield* Fiber.join(aliceFiber);

      assert.deepStrictEqual(bobEvents, [{ event: new PeerJoinedEvent({ peerId: alice }) }]);
      assert.deepStrictEqual(aliceEvents, [
        { event: new PeerJoinedEvent({ peerId: bob }) },
        { event: new PeerLeftEvent({ peerId: bob }) },
      ]);
    }),
  );

  it.effect('filters the sender own events', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .JoinRoom({ roomId, selfId: alice })
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }));

      yield* client.SendSignal({
        roomId,
        selfId: alice,
        signal: { type: 'offer', sdp: 'self-offer' },
      });
      const bobFiber = yield* client
        .JoinRoom({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.deepStrictEqual(aliceEvents, [{ event: new PeerJoinedEvent({ peerId: bob }) }]);
    }),
  );

  it.effect('relays a signal to the other peer', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .JoinRoom({ roomId, selfId: alice })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client
        .JoinRoom({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      yield* client.SendSignal({
        roomId,
        selfId: bob,
        signal: { type: 'answer', sdp: 'test-answer' },
      });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.deepStrictEqual(aliceEvents, [
        { event: new PeerJoinedEvent({ peerId: bob }) },
        {
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: { type: 'answer', sdp: 'test-answer' },
          }),
        },
      ]);
    }),
  );

  it.effect('does not relay signals from a peer outside the room', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .JoinRoom({ roomId, selfId: alice })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client
        .JoinRoom({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      const error = yield* client
        .SendSignal({
          roomId,
          selfId: mallory,
          signal: { type: 'offer', sdp: 'unauthorized-offer' },
        })
        .pipe(Effect.flip);
      yield* client.SendSignal({
        roomId,
        selfId: bob,
        signal: { type: 'answer', sdp: 'authorized-answer' },
      });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.instanceOf(error, PeerNotInRoom);
      assert.strictEqual(error.roomId, roomId);
      assert.strictEqual(error.peerId, mallory);
      assert.deepStrictEqual(aliceEvents, [
        { event: new PeerJoinedEvent({ peerId: bob }) },
        {
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: { type: 'answer', sdp: 'authorized-answer' },
          }),
        },
      ]);
    }),
  );

  it.effect('returns RoomFull through the RPC error channel', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .JoinRoom({ roomId, selfId: alice })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client
        .JoinRoom({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      const error = yield* client
        .JoinRoom({ roomId, selfId: charlie })
        .pipe(Stream.runDrain, Effect.flip);

      yield* Fiber.interrupt(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.instanceOf(error, RoomFull);
      assert.strictEqual(error.roomId, roomId);
    }),
  );

  it.effect('returns PeerAlreadyJoined through the RPC error channel', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .JoinRoom({ roomId, selfId: alice })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client
        .JoinRoom({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      const error = yield* client
        .JoinRoom({ roomId, selfId: alice })
        .pipe(Stream.runDrain, Effect.flip);

      yield* Fiber.interrupt(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.instanceOf(error, PeerAlreadyJoined);
      assert.strictEqual(error.roomId, roomId);
      assert.strictEqual(error.peerId, alice);
    }),
  );
});

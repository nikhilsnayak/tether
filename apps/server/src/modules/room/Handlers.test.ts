import { assert, describe, it } from '@effect/vitest';
import {
  IceCandidateSignal,
  PeerId,
  PeerAlreadyJoined,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomFull,
  RoomId,
  RoomRpcs,
  RoomSessionOpenedEvent,
  SessionDescriptionSignal,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
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

const makeClientWithEnv = (env: Record<string, string>) =>
  RpcTest.makeClient(RoomRpcs).pipe(
    Effect.provide(
      TestHandlers.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
    ),
  );

describe('RoomHandlers', () => {
  it.effect('returns the default STUN server', () =>
    Effect.gen(function* () {
      const client = yield* makeClientWithEnv({});

      const result = yield* client.GetIceServers();

      assert.deepStrictEqual(result, {
        iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
      });
    }),
  );

  it.effect('returns configured TURN credentials', () =>
    Effect.gen(function* () {
      const client = yield* makeClientWithEnv({
        TURN_URL: 'turn:turn.example.com:3478',
        TURN_USERNAME: 'turn-user',
        TURN_CREDENTIAL: 'turn-password',
      });

      const result = yield* client.GetIceServers();

      assert.deepStrictEqual(result, {
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          {
            urls: ['turn:turn.example.com:3478'],
            username: 'turn-user',
            credential: 'turn-password',
          },
        ],
      });
    }),
  );

  it.effect('acknowledges the session and leaves when its stream closes', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }));

      const bobEvents = yield* client
        .OpenRoomSession({ roomId, selfId: bob })
        .pipe(Stream.take(1), Stream.runCollect);
      const aliceEvents = yield* Fiber.join(aliceFiber);

      assert.deepStrictEqual(bobEvents, [{ event: new RoomSessionOpenedEvent({ peerId: alice }) }]);
      assert.deepStrictEqual(aliceEvents, [
        { event: new RoomSessionOpenedEvent({ peerId: null }) },
        { event: new PeerJoinedEvent({ peerId: bob }) },
        { event: new PeerLeftEvent({ peerId: bob }) },
      ]);
    }),
  );

  it.effect('explicitly leaves through the RPC', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const bobOpened = yield* Deferred.make<void>();
      const aliceFiber = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client.OpenRoomSession({ roomId, selfId: bob }).pipe(
        Stream.tap(() => Deferred.succeed(bobOpened, undefined)),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      );

      yield* Deferred.await(bobOpened);
      yield* client.LeaveRoom({ roomId, selfId: bob });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.deepStrictEqual(aliceEvents, [
        { event: new RoomSessionOpenedEvent({ peerId: null }) },
        { event: new PeerJoinedEvent({ peerId: bob }) },
        { event: new PeerLeftEvent({ peerId: bob }) },
      ]);
    }),
  );

  it.effect('filters the sender own events', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }));

      yield* client.SendSignal({
        roomId,
        selfId: alice,
        signal: new SessionDescriptionSignal({ type: 'offer', sdp: 'self-offer' }),
      });
      const bobFiber = yield* client
        .OpenRoomSession({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.deepStrictEqual(aliceEvents, [
        { event: new RoomSessionOpenedEvent({ peerId: null }) },
        { event: new PeerJoinedEvent({ peerId: bob }) },
      ]);
    }),
  );

  it.effect('relays a signal to the other peer', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client
        .OpenRoomSession({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      yield* client.SendSignal({
        roomId,
        selfId: bob,
        signal: new IceCandidateSignal({
          candidate: 'candidate:integration-test',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'test-fragment',
        }),
      });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.deepStrictEqual(aliceEvents, [
        { event: new RoomSessionOpenedEvent({ peerId: null }) },
        { event: new PeerJoinedEvent({ peerId: bob }) },
        {
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new IceCandidateSignal({
              candidate: 'candidate:integration-test',
              sdpMid: '0',
              sdpMLineIndex: 0,
              usernameFragment: 'test-fragment',
            }),
          }),
        },
      ]);
    }),
  );

  it.effect('does not relay signals from a peer outside the room', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client
        .OpenRoomSession({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      const error = yield* client
        .SendSignal({
          roomId,
          selfId: mallory,
          signal: new SessionDescriptionSignal({
            type: 'offer',
            sdp: 'unauthorized-offer',
          }),
        })
        .pipe(Effect.flip);
      yield* client.SendSignal({
        roomId,
        selfId: bob,
        signal: new SessionDescriptionSignal({ type: 'answer', sdp: 'authorized-answer' }),
      });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.instanceOf(error, PeerNotInRoom);
      assert.strictEqual(error.roomId, roomId);
      assert.strictEqual(error.peerId, mallory);
      assert.deepStrictEqual(aliceEvents, [
        { event: new RoomSessionOpenedEvent({ peerId: null }) },
        { event: new PeerJoinedEvent({ peerId: bob }) },
        {
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              type: 'answer',
              sdp: 'authorized-answer',
            }),
          }),
        },
      ]);
    }),
  );

  it.effect('returns RoomFull through the RPC error channel', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceFiber = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client
        .OpenRoomSession({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      const error = yield* client
        .OpenRoomSession({ roomId, selfId: charlie })
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
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client
        .OpenRoomSession({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      const error = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.runDrain, Effect.flip);

      yield* Fiber.interrupt(aliceFiber);
      yield* Fiber.interrupt(bobFiber);

      assert.instanceOf(error, PeerAlreadyJoined);
      assert.strictEqual(error.roomId, roomId);
      assert.strictEqual(error.peerId, alice);
    }),
  );
});

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
  ServerAtCapacity,
  SessionDescriptionSignal,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { RpcTest } from 'effect/unstable/rpc';

import { MAX_LIVE_ROOMS } from './Constants';
import { RoomHandlers } from './Handlers';
import { RoomService } from './RoomService';

const roomId = RoomId.make('abc-defg-hij');
const alice = PeerId.make('aaaaaaaaaaaa');
const bob = PeerId.make('bbbbbbbbbbbb');
const charlie = PeerId.make('cccccccccccc');
const mallory = PeerId.make('mmmmmmmmmmmm');

const letters = (length: number, index: number) => {
  const value = Array.from({ length }, () => 'a');
  for (let position = length - 1; position >= 0; position--) {
    value[position] = String.fromCharCode(97 + (index % 26));
    index = Math.floor(index / 26);
  }
  return value.join('');
};
const randomRoomId = (index: number) => {
  const value = letters(10, index);
  return RoomId.make(`${value.slice(0, 3)}-${value.slice(3, 7)}-${value.slice(7)}`);
};
const randomPeerId = (index: number) => PeerId.make(letters(12, index));

const TestHandlers = RoomHandlers.pipe(Layer.provide(RoomService.layerTest));

const makeClient = RpcTest.makeClient(RoomRpcs).pipe(Effect.provide(TestHandlers));

const requireOpenedEvent = (entry: { readonly event: unknown } | undefined) => {
  assert.instanceOf(entry?.event, RoomSessionOpenedEvent);
  return entry!.event as RoomSessionOpenedEvent;
};

describe('RoomHandlers', () => {
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
      const bobOpened = requireOpenedEvent(bobEvents[0]);
      const aliceOpened = requireOpenedEvent(aliceEvents[0]);

      assert.deepStrictEqual(bobEvents, [
        {
          event: new RoomSessionOpenedEvent({
            peerId: alice,
            sessionToken: bobOpened.sessionToken,
          }),
        },
      ]);
      assert.deepStrictEqual(aliceEvents, [
        {
          event: new RoomSessionOpenedEvent({
            peerId: null,
            sessionToken: aliceOpened.sessionToken,
          }),
        },
        { event: new PeerJoinedEvent({ peerId: bob }) },
        { event: new PeerLeftEvent({ peerId: bob }) },
      ]);
    }),
  );

  it.effect('explicitly leaves through the RPC', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const bobToken = yield* Deferred.make<string>();
      const aliceFiber = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client.OpenRoomSession({ roomId, selfId: bob }).pipe(
        Stream.tap(({ event }) =>
          event._tag === '@tether/RoomSessionOpenedEvent'
            ? Deferred.succeed(bobToken, event.sessionToken)
            : Effect.void,
        ),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      );

      const sessionToken = yield* Deferred.await(bobToken);
      yield* client.LeaveRoom({ roomId, selfId: bob, sessionToken });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);
      const aliceOpened = requireOpenedEvent(aliceEvents[0]);

      assert.deepStrictEqual(aliceEvents, [
        {
          event: new RoomSessionOpenedEvent({
            peerId: null,
            sessionToken: aliceOpened.sessionToken,
          }),
        },
        { event: new PeerJoinedEvent({ peerId: bob }) },
        { event: new PeerLeftEvent({ peerId: bob }) },
      ]);
    }),
  );

  it.effect('filters the sender own events', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const aliceToken = yield* Deferred.make<string>();
      const aliceFiber = yield* client.OpenRoomSession({ roomId, selfId: alice }).pipe(
        Stream.tap(({ event }) =>
          event._tag === '@tether/RoomSessionOpenedEvent'
            ? Deferred.succeed(aliceToken, event.sessionToken)
            : Effect.void,
        ),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      );

      yield* client.SendSignal({
        roomId,
        selfId: alice,
        sessionToken: yield* Deferred.await(aliceToken),
        signal: new SessionDescriptionSignal({ type: 'offer', sdp: 'self-offer' }),
      });
      const bobFiber = yield* client
        .OpenRoomSession({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);
      const aliceOpened = requireOpenedEvent(aliceEvents[0]);

      assert.deepStrictEqual(aliceEvents, [
        {
          event: new RoomSessionOpenedEvent({
            peerId: null,
            sessionToken: aliceOpened.sessionToken,
          }),
        },
        { event: new PeerJoinedEvent({ peerId: bob }) },
      ]);
    }),
  );

  it.effect('relays a signal to the other peer', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const bobToken = yield* Deferred.make<string>();
      const aliceFiber = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client.OpenRoomSession({ roomId, selfId: bob }).pipe(
        Stream.tap(({ event }) =>
          event._tag === '@tether/RoomSessionOpenedEvent'
            ? Deferred.succeed(bobToken, event.sessionToken)
            : Effect.void,
        ),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      );

      yield* client.SendSignal({
        roomId,
        selfId: bob,
        sessionToken: yield* Deferred.await(bobToken),
        signal: new IceCandidateSignal({
          candidate: 'candidate:integration-test',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'test-fragment',
        }),
      });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);
      const aliceOpened = requireOpenedEvent(aliceEvents[0]);

      assert.deepStrictEqual(aliceEvents, [
        {
          event: new RoomSessionOpenedEvent({
            peerId: null,
            sessionToken: aliceOpened.sessionToken,
          }),
        },
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
      const bobToken = yield* Deferred.make<string>();
      const aliceFiber = yield* client
        .OpenRoomSession({ roomId, selfId: alice })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      const bobFiber = yield* client.OpenRoomSession({ roomId, selfId: bob }).pipe(
        Stream.tap(({ event }) =>
          event._tag === '@tether/RoomSessionOpenedEvent'
            ? Deferred.succeed(bobToken, event.sessionToken)
            : Effect.void,
        ),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      );

      const error = yield* client
        .SendSignal({
          roomId,
          selfId: mallory,
          sessionToken: 'invalid-session-token',
          signal: new SessionDescriptionSignal({
            type: 'offer',
            sdp: 'unauthorized-offer',
          }),
        })
        .pipe(Effect.flip);
      yield* client.SendSignal({
        roomId,
        selfId: bob,
        sessionToken: yield* Deferred.await(bobToken),
        signal: new SessionDescriptionSignal({ type: 'answer', sdp: 'authorized-answer' }),
      });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      yield* Fiber.interrupt(bobFiber);
      const aliceOpened = requireOpenedEvent(aliceEvents[0]);

      assert.instanceOf(error, PeerNotInRoom);
      assert.strictEqual(error.roomId, roomId);
      assert.strictEqual(error.peerId, mallory);
      assert.deepStrictEqual(aliceEvents, [
        {
          event: new RoomSessionOpenedEvent({
            peerId: null,
            sessionToken: aliceOpened.sessionToken,
          }),
        },
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

  it.effect('returns ServerAtCapacity through the RPC error channel', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;

      yield* Effect.forEach(
        Array.from({ length: MAX_LIVE_ROOMS }, (_, index) => index),
        (index) =>
          client
            .OpenRoomSession({ roomId: randomRoomId(index), selfId: randomPeerId(index) })
            .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true })),
        { discard: true },
      );

      const error = yield* client
        .OpenRoomSession({ roomId: RoomId.make('zzz-zzzz-zzz'), selfId: alice })
        .pipe(Stream.runDrain, Effect.flip);

      assert.instanceOf(error, ServerAtCapacity);
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

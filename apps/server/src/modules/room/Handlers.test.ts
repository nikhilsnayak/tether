import { assert, describe, it } from '@effect/vitest';
import {
  DUSK_SUITE_TEMPLATE_ID,
  DisplayName,
  JoinDenied,
  JoinRequestedEvent,
  PeerAlreadyJoined,
  PeerId,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomFull,
  RoomId,
  RoomNotFound,
  RoomSessionOpenedEvent,
  ServerAtCapacity,
  SessionToken,
  SessionDescriptionSignal,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { Deferred, Effect, Fiber, Schema, Stream } from 'effect';

import { ROOM_CREATE_BUCKET_CAPACITY } from './Constants';
import { makeRoomRpcTestHarness } from './test/RoomRpcTestHarness';

const alice = PeerId.make('aaaaaaaaaaaa');
const bob = PeerId.make('bbbbbbbbbbbb');
const charlie = PeerId.make('cccccccccccc');
const mallory = PeerId.make('mmmmmmmmmmmm');
const bobName = Schema.decodeUnknownSync(DisplayName)('Bob');
const charlieName = Schema.decodeUnknownSync(DisplayName)('Charlie');

const letters = (length: number, index: number) => {
  const value = Array.from({ length }, () => 'a');
  for (let position = length - 1; position >= 0; position--) {
    value[position] = String.fromCharCode(97 + (index % 26));
    index = Math.floor(index / 26);
  }
  return value.join('');
};
const randomPeerId = (index: number) => PeerId.make(letters(12, index));

const isJoinRequestedEvent = Schema.is(JoinRequestedEvent);
const isRoomSessionOpenedEvent = Schema.is(RoomSessionOpenedEvent);

describe('RoomHandlers', () => {
  it.effect('relays a departure when the joiner stream closes', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();
      const { aliceFiber, bobFiber } = yield* harness.connect({
        hostTake: 4,
        joinerTake: 2,
      });

      // Bob's stream completes after [JoinPending, RoomSessionOpened], closing
      // the session, which the host observes as a departure.
      yield* Fiber.join(bobFiber);
      const aliceEvents = yield* Fiber.join(aliceFiber);

      assert.deepStrictEqual(aliceEvents[3], { event: new PeerLeftEvent({ peerId: bob }) });
    }),
  );

  it.effect('explicitly leaves through the RPC', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();
      const { roomId, bobToken, aliceFiber } = yield* harness.connect({
        hostTake: 4,
      });

      yield* harness.client.LeaveRoom({ roomId, selfId: bob, sessionToken: bobToken });
      const aliceEvents = yield* Fiber.join(aliceFiber);

      assert.deepStrictEqual(aliceEvents[3], { event: new PeerLeftEvent({ peerId: bob }) });
    }),
  );

  it.effect('relays a signal to the other peer', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();
      const { roomId, bobToken, aliceFiber } = yield* harness.connect({
        hostTake: 4,
      });

      const signal = new SessionDescriptionSignal({
        negotiationEpoch: 7,
        type: 'offer',
        sdp: 'relayed-offer',
      });
      yield* harness.client.SendSignal({ roomId, selfId: bob, sessionToken: bobToken, signal });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      assert.deepStrictEqual(aliceEvents[3], {
        event: new SignalReceivedEvent({ peerId: bob, signal }),
      });
    }),
  );

  it.effect('accepts detachment readiness before detachment is implemented', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();

      yield* harness.client.ReadyToDetach({
        roomId: RoomId.make('abc-defg-hij'),
        selfId: alice,
        sessionToken: SessionToken.make('session-token'),
        negotiationEpoch: 0,
      });
    }),
  );

  it.effect('does not relay signals from a peer outside the room', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();
      const { roomId } = yield* harness.connect();

      const error = yield* harness.client
        .SendSignal({
          roomId,
          selfId: mallory,
          sessionToken: SessionToken.make('invalid-session-token'),
          signal: new SessionDescriptionSignal({
            negotiationEpoch: 0,
            type: 'offer',
            sdp: 'unauthorized-offer',
          }),
        })
        .pipe(Effect.flip);

      assert.instanceOf(error, PeerNotInRoom);
      assert.strictEqual(error.peerId, mallory);
    }),
  );

  it.effect('rejects a third peer with RoomFull', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();
      const { roomId } = yield* harness.connect();

      const error = yield* harness.client
        .OpenRoomSession({ selfId: charlie, intent: 'join', roomId, displayName: charlieName })
        .pipe(Stream.runDrain, Effect.flip);

      assert.instanceOf(error, RoomFull);
      assert.strictEqual(error.roomId, roomId);
    }),
  );

  it.effect('returns RoomNotFound for a join to an unknown room', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();

      const error = yield* harness.client
        .OpenRoomSession({
          selfId: bob,
          intent: 'join',
          roomId: RoomId.make('zzz-zzzz-zzz'),
          displayName: bobName,
        })
        .pipe(Stream.runDrain, Effect.flip);

      assert.instanceOf(error, RoomNotFound);
    }),
  );

  it.effect('returns RoomNotFound for metadata lookup on an unknown room', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();
      const error = yield* harness.client
        .GetRoomMetadata({ roomId: RoomId.make('abc-defg-hij') })
        .pipe(Effect.flip);
      assert.instanceOf(error, RoomNotFound);
    }),
  );

  it.effect('returns ServerAtCapacity when the creation bucket is drained', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();

      yield* Effect.forEach(
        Array.from({ length: ROOM_CREATE_BUCKET_CAPACITY }, (_, index) => index),
        (index) =>
          harness.client
            .OpenRoomSession({
              selfId: randomPeerId(index),
              intent: 'host',
              roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
            })
            .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true })),
        { discard: true },
      );

      const error = yield* harness.client
        .OpenRoomSession({
          selfId: randomPeerId(999),
          intent: 'host',
          roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
        })
        .pipe(Stream.runDrain, Effect.flip);

      assert.instanceOf(error, ServerAtCapacity);
    }),
  );

  it.effect('returns PeerAlreadyJoined when a member rejoins', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();
      const { roomId } = yield* harness.connect();

      const error = yield* harness.client
        .OpenRoomSession({ selfId: bob, intent: 'join', roomId, displayName: bobName })
        .pipe(Stream.runDrain, Effect.flip);

      assert.instanceOf(error, PeerAlreadyJoined);
      assert.strictEqual(error.peerId, bob);
    }),
  );

  it.effect('denies a joiner through RespondToJoin', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();
      const roomIdDeferred = yield* Deferred.make<RoomId>();
      const aliceTokenDeferred = yield* Deferred.make<SessionToken>();
      const knockDeferred = yield* Deferred.make<void>();

      yield* harness.client
        .OpenRoomSession({ selfId: alice, intent: 'host', roomTemplateId: DUSK_SUITE_TEMPLATE_ID })
        .pipe(
          Stream.tap((entry) => {
            if (isRoomSessionOpenedEvent(entry.event)) {
              return Effect.all([
                Deferred.succeed(roomIdDeferred, entry.event.roomId),
                Deferred.succeed(aliceTokenDeferred, entry.event.sessionToken),
              ]);
            }
            return isJoinRequestedEvent(entry.event)
              ? Deferred.succeed(knockDeferred, undefined)
              : Effect.void;
          }),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
      const roomId = yield* Deferred.await(roomIdDeferred);
      const aliceToken = yield* Deferred.await(aliceTokenDeferred);

      const bobFiber = yield* harness.client
        .OpenRoomSession({ selfId: bob, intent: 'join', roomId, displayName: bobName })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      yield* Deferred.await(knockDeferred);
      yield* harness.client.RespondToJoin({
        roomId,
        selfId: alice,
        sessionToken: aliceToken,
        peerId: bob,
        decision: 'deny',
      });

      const error = yield* Fiber.join(bobFiber).pipe(Effect.flip);
      assert.instanceOf(error, JoinDenied);
    }),
  );

  it.effect('rejects RespondToJoin from a caller with a bad token', () =>
    Effect.gen(function* () {
      const harness = yield* makeRoomRpcTestHarness();
      const { roomId } = yield* harness.connect();

      const error = yield* harness.client
        .RespondToJoin({
          roomId,
          selfId: alice,
          sessionToken: SessionToken.make('wrong-session-token'),
          peerId: charlie,
          decision: 'allow',
        })
        .pipe(Effect.flip);

      assert.instanceOf(error, PeerNotInRoom);
      assert.strictEqual(error.peerId, alice);
    }),
  );
});

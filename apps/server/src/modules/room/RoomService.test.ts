import { assert, describe, it } from '@effect/vitest';
import {
  PeerId,
  PeerAlreadyJoined,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomFull,
  RoomId,
  RoomSessionOpenedEvent,
  ServerAtCapacity,
  SessionDescriptionSignal,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { Effect, Exit, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import { MAX_LIVE_ROOMS, SIGNAL_BUCKET_CAPACITY } from './Constants';
import { RoomService } from './RoomService';

const roomId = RoomId.make('abc-defg-hij');
const alice = PeerId.make('aaaaaaaaaaaa');
const bob = PeerId.make('bbbbbbbbbbbb');
const charlie = PeerId.make('cccccccccccc');

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

const withRoomService = <A, E, R>(effect: Effect.Effect<A, E, R | RoomService>) =>
  effect.pipe(Effect.provide(RoomService.layerTest));

const requireOpenedEvent = (event: unknown): RoomSessionOpenedEvent => {
  assert.instanceOf(event, RoomSessionOpenedEvent);
  return event as RoomSessionOpenedEvent;
};

describe('RoomService', () => {
  it.effect('ignores leave requests for rooms that do not exist', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        yield* room.leave(roomId, alice, 'unknown-session');
      }),
    ),
  );

  it.effect('returns the existing peer and rejects a third member', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;

        const first = yield* room.openSession(roomId, alice);
        const second = yield* room.openSession(roomId, bob);
        const error = yield* room.openSession(roomId, charlie).pipe(Effect.flip);
        const firstEvents = yield* first.pipe(Stream.take(2), Stream.runCollect);
        const secondEvents = yield* second.pipe(Stream.take(1), Stream.runCollect);
        const firstOpened = requireOpenedEvent(firstEvents[0]);
        const secondOpened = requireOpenedEvent(secondEvents[0]);

        assert.deepStrictEqual(firstEvents, [
          new RoomSessionOpenedEvent({ peerId: null, sessionToken: firstOpened.sessionToken }),
          new PeerJoinedEvent({ peerId: bob }),
        ]);
        assert.deepStrictEqual(secondEvents, [
          new RoomSessionOpenedEvent({
            peerId: alice,
            sessionToken: secondOpened.sessionToken,
          }),
        ]);
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
          (peerId) => room.openSession(roomId, peerId).pipe(Effect.exit),
          { concurrency: 'unbounded' },
        );

        assert.lengthOf(exits.filter(Exit.isSuccess), 2);
        assert.lengthOf(exits.filter(Exit.isFailure), 1);
      }),
    ),
  );

  it.effect('publishes lifecycle events and leaves when the session scope closes', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const events = yield* room.openSession(roomId, alice);
        yield* Effect.scoped(room.openSession(roomId, bob));
        const received = yield* events.pipe(Stream.take(3), Stream.runCollect);
        const opened = requireOpenedEvent(received[0]);

        assert.deepStrictEqual(received, [
          new RoomSessionOpenedEvent({ peerId: null, sessionToken: opened.sessionToken }),
          new PeerJoinedEvent({ peerId: bob }),
          new PeerLeftEvent({ peerId: bob }),
        ]);
      }),
    ),
  );

  it.effect('explicitly leaves once and releases room capacity', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const aliceEvents = yield* room.openSession(roomId, alice);
        const bobEvents = yield* room.openSession(roomId, bob);
        const bobOpened = requireOpenedEvent(
          (yield* bobEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );

        yield* room.leave(roomId, bob, bobOpened.sessionToken);
        yield* room.leave(roomId, bob, bobOpened.sessionToken);

        const received = yield* aliceEvents.pipe(Stream.take(3), Stream.runCollect);
        const aliceOpened = requireOpenedEvent(received[0]);
        assert.deepStrictEqual(received, [
          new RoomSessionOpenedEvent({ peerId: null, sessionToken: aliceOpened.sessionToken }),
          new PeerJoinedEvent({ peerId: bob }),
          new PeerLeftEvent({ peerId: bob }),
        ]);

        const replacement = yield* room.openSession(roomId, charlie);
        const replacementEvents = yield* replacement.pipe(Stream.take(1), Stream.runCollect);
        const replacementOpened = requireOpenedEvent(replacementEvents[0]);
        assert.deepStrictEqual(replacementEvents, [
          new RoomSessionOpenedEvent({
            peerId: alice,
            sessionToken: replacementOpened.sessionToken,
          }),
        ]);
      }),
    ),
  );

  it.effect('rejects a duplicate peer before checking room capacity', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        yield* room.openSession(roomId, alice);
        yield* room.openSession(roomId, bob);

        const error = yield* room.openSession(roomId, alice).pipe(Effect.flip);

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
        const events = yield* room.openSession(roomId, alice);
        const bobEvents = yield* room.openSession(roomId, bob);
        const bobOpened = requireOpenedEvent(
          (yield* bobEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const event = new SignalReceivedEvent({
          peerId: bob,
          signal: new SessionDescriptionSignal({ type: 'offer', sdp: 'test-offer' }),
        });

        yield* room.sendSignal(roomId, bob, bobOpened.sessionToken, event.signal);
        const received = yield* events.pipe(Stream.take(3), Stream.runCollect);
        const opened = requireOpenedEvent(received[0]);

        assert.deepStrictEqual(received, [
          new RoomSessionOpenedEvent({ peerId: null, sessionToken: opened.sessionToken }),
          new PeerJoinedEvent({ peerId: bob }),
          event,
        ]);
      }),
    ),
  );

  it.effect('delivers signals to the peer in FIFO order', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const aliceEvents = yield* room.openSession(roomId, alice);
        const bobEvents = yield* room.openSession(roomId, bob);
        const bobOpened = requireOpenedEvent(
          (yield* bobEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );

        const signals = ['one', 'two', 'three'].map(
          (sdp) => new SessionDescriptionSignal({ type: 'offer' as const, sdp }),
        );

        yield* Effect.forEach(signals, (signal) =>
          room.sendSignal(roomId, bob, bobOpened.sessionToken, signal),
        );

        const received = yield* aliceEvents.pipe(Stream.take(5), Stream.runCollect);
        const opened = requireOpenedEvent(received[0]);

        assert.deepStrictEqual(received, [
          new RoomSessionOpenedEvent({ peerId: null, sessionToken: opened.sessionToken }),
          new PeerJoinedEvent({ peerId: bob }),
          ...signals.map((signal) => new SignalReceivedEvent({ peerId: bob, signal })),
        ]);
      }),
    ),
  );

  it.effect('silently drops signals beyond the member rate limit', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const aliceEvents = yield* room.openSession(roomId, alice);
        const aliceOpened = requireOpenedEvent(
          (yield* aliceEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const bobEvents = yield* room.openSession(roomId, bob);
        const signal = new SessionDescriptionSignal({ type: 'offer', sdp: 'flood' });

        const results = yield* Effect.forEach(
          Array.from({ length: SIGNAL_BUCKET_CAPACITY + 10 }),
          () => room.sendSignal(roomId, alice, aliceOpened.sessionToken, signal),
        );
        const received = yield* bobEvents.pipe(
          Stream.take(SIGNAL_BUCKET_CAPACITY + 1),
          Stream.runCollect,
        );

        assert.lengthOf(results, SIGNAL_BUCKET_CAPACITY + 10);
        assert.lengthOf(
          received.filter((event) => event instanceof SignalReceivedEvent),
          SIGNAL_BUCKET_CAPACITY,
        );
      }),
    ),
  );

  it.effect('refills a member signal bucket over time', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const aliceEvents = yield* room.openSession(roomId, alice);
        const aliceOpened = requireOpenedEvent(
          (yield* aliceEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const bobEvents = yield* room.openSession(roomId, bob);
        const signal = new SessionDescriptionSignal({ type: 'offer', sdp: 'refill' });

        yield* Effect.forEach(Array.from({ length: SIGNAL_BUCKET_CAPACITY }), () =>
          room.sendSignal(roomId, alice, aliceOpened.sessionToken, signal),
        );
        yield* TestClock.adjust('1 second');
        yield* Effect.forEach(Array.from({ length: 5 }), () =>
          room.sendSignal(roomId, alice, aliceOpened.sessionToken, signal),
        );

        const received = yield* bobEvents.pipe(
          Stream.take(SIGNAL_BUCKET_CAPACITY + 6),
          Stream.runCollect,
        );
        assert.lengthOf(
          received.filter((event) => event instanceof SignalReceivedEvent),
          SIGNAL_BUCKET_CAPACITY + 5,
        );
      }),
    ),
  );

  it.effect('maintains a separate signal bucket for each member', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const aliceEvents = yield* room.openSession(roomId, alice);
        const aliceOpened = requireOpenedEvent(
          (yield* aliceEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const bobEvents = yield* room.openSession(roomId, bob);
        const bobOpened = requireOpenedEvent(
          (yield* bobEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const aliceSignal = new SessionDescriptionSignal({ type: 'offer', sdp: 'alice' });
        const bobSignal = new SessionDescriptionSignal({ type: 'answer', sdp: 'bob' });

        yield* Effect.forEach(Array.from({ length: SIGNAL_BUCKET_CAPACITY }), () =>
          room.sendSignal(roomId, alice, aliceOpened.sessionToken, aliceSignal),
        );
        yield* room.sendSignal(roomId, bob, bobOpened.sessionToken, bobSignal);

        const received = yield* aliceEvents.pipe(Stream.take(3), Stream.runCollect);
        assert.deepStrictEqual(
          received.filter((event) => event instanceof SignalReceivedEvent),
          [new SignalReceivedEvent({ peerId: bob, signal: bobSignal })],
        );
      }),
    ),
  );

  it.effect('caps new rooms while allowing joins to existing rooms', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;

        yield* Effect.forEach(
          Array.from({ length: MAX_LIVE_ROOMS }, (_, index) => index),
          (index) => room.openSession(randomRoomId(index), randomPeerId(index)),
          { discard: true },
        );

        const error = yield* room.openSession(RoomId.make('zzz-zzzz-zzz'), alice).pipe(Effect.flip);
        const existingRoomEvents = yield* room.openSession(randomRoomId(0), bob);
        const existingRoomOpened = requireOpenedEvent(
          (yield* existingRoomEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );

        assert.instanceOf(error, ServerAtCapacity);
        assert.strictEqual(existingRoomOpened.peerId, randomPeerId(0));
      }),
    ),
  );

  it.effect('does not lose a signal published before the newcomer consumes', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const aliceEvents = yield* room.openSession(roomId, alice);
        const aliceOpened = requireOpenedEvent(
          (yield* aliceEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const bobEvents = yield* room.openSession(roomId, bob);

        const signal = new SignalReceivedEvent({
          peerId: alice,
          signal: new SessionDescriptionSignal({ type: 'offer', sdp: 'immediate-offer' }),
        });
        yield* room.sendSignal(roomId, alice, aliceOpened.sessionToken, signal.signal);

        const received = yield* bobEvents.pipe(Stream.take(2), Stream.runCollect);
        const bobOpened = requireOpenedEvent(received[0]);

        assert.deepStrictEqual(received, [
          new RoomSessionOpenedEvent({ peerId: alice, sessionToken: bobOpened.sessionToken }),
          signal,
        ]);
      }),
    ),
  );

  it.effect('rejects an attempt to kick a member with another member token', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const aliceEvents = yield* room.openSession(roomId, alice);
        const aliceOpened = requireOpenedEvent(
          (yield* aliceEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const bobEvents = yield* room.openSession(roomId, bob);
        const bobOpened = requireOpenedEvent(
          (yield* bobEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const signal = new SessionDescriptionSignal({
          type: 'offer',
          sdp: 'still-a-member',
        });

        yield* room.leave(roomId, alice, bobOpened.sessionToken);
        yield* room.sendSignal(roomId, alice, aliceOpened.sessionToken, signal);

        const received = yield* bobEvents.pipe(Stream.take(2), Stream.runCollect);
        assert.deepStrictEqual(received, [
          new RoomSessionOpenedEvent({
            peerId: alice,
            sessionToken: bobOpened.sessionToken,
          }),
          new SignalReceivedEvent({ peerId: alice, signal }),
        ]);
      }),
    ),
  );

  it.effect('rejects forged signals while accepting the member token', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const aliceEvents = yield* room.openSession(roomId, alice);
        const aliceOpened = requireOpenedEvent(
          (yield* aliceEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const signal = new SessionDescriptionSignal({ type: 'offer', sdp: 'authenticated' });

        const error = yield* room
          .sendSignal(roomId, alice, 'wrong-session-token', signal)
          .pipe(Effect.flip);
        yield* room.sendSignal(roomId, alice, aliceOpened.sessionToken, signal);

        assert.instanceOf(error, PeerNotInRoom);
        assert.strictEqual(error.roomId, roomId);
        assert.strictEqual(error.peerId, alice);
      }),
    ),
  );

  it.effect('removes a member when its session scope closes', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const sessionScope = yield* Scope.make();
        const events = yield* room.openSession(roomId, alice).pipe(Scope.provide(sessionScope));
        const opened = requireOpenedEvent(
          (yield* events.pipe(Stream.take(1), Stream.runCollect))[0],
        );

        yield* Scope.close(sessionScope, Exit.void);

        const error = yield* room
          .sendSignal(
            roomId,
            alice,
            opened.sessionToken,
            new SessionDescriptionSignal({ type: 'offer', sdp: 'after-close' }),
          )
          .pipe(Effect.flip);
        assert.instanceOf(error, PeerNotInRoom);
      }),
    ),
  );

  it.effect('issues distinct non-empty tokens to each member', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const aliceEvents = yield* room.openSession(roomId, alice);
        const bobEvents = yield* room.openSession(roomId, bob);
        const aliceOpened = requireOpenedEvent(
          (yield* aliceEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        const bobOpened = requireOpenedEvent(
          (yield* bobEvents.pipe(Stream.take(1), Stream.runCollect))[0],
        );

        assert.isNotEmpty(aliceOpened.sessionToken);
        assert.isNotEmpty(bobOpened.sessionToken);
        assert.notStrictEqual(aliceOpened.sessionToken, bobOpened.sessionToken);
      }),
    ),
  );

  it.effect('removes an empty room', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        yield* Effect.scoped(room.openSession(roomId, alice));

        const error = yield* room
          .sendSignal(
            roomId,
            alice,
            'invalid-session-token',
            new SessionDescriptionSignal({ type: 'offer', sdp: 'missing-room' }),
          )
          .pipe(Effect.flip);
        yield* room.openSession(roomId, bob);

        assert.instanceOf(error, PeerNotInRoom);
        assert.strictEqual(error.roomId, roomId);
        assert.strictEqual(error.peerId, alice);
      }),
    ),
  );
});

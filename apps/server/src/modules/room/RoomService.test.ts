import { assert, describe, it } from '@effect/vitest';
import {
  DisplayName,
  JoinCancelledEvent,
  JoinDenied,
  JoinPendingEvent,
  JoinRequestedEvent,
  NoPendingJoin,
  PeerId,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomFull,
  RoomId,
  RoomNotFound,
  RoomSessionOpenedEvent,
  ServerAtCapacity,
  SessionDescriptionSignal,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { Crypto, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import * as ServerCrypto from '@/lib/ServerCrypto';

import {
  MAX_LIVE_ROOMS,
  ROOM_CREATE_BUCKET_CAPACITY,
  ROOM_CREATE_BUCKET_REFILL_EVERY,
  SIGNAL_BUCKET_CAPACITY,
} from './Constants';
import { RoomService } from './RoomService';

const alice = PeerId.make('aaaaaaaaaaaa');
const bob = PeerId.make('bbbbbbbbbbbb');
const charlie = PeerId.make('cccccccccccc');

const name = (value: string) => Schema.decodeUnknownSync(DisplayName)(value);
const bobName = name('Bob');
const charlieName = name('Charlie');

const letters = (length: number, index: number) => {
  const value = Array.from({ length }, () => 'a');
  for (let position = length - 1; position >= 0; position--) {
    value[position] = String.fromCharCode(97 + (index % 26));
    index = Math.floor(index / 26);
  }
  return value.join('');
};
const randomPeerId = (index: number) => PeerId.make(letters(12, index));

const withRoomService = <A, E, R>(effect: Effect.Effect<A, E, R | RoomService>) =>
  effect.pipe(Effect.provide(RoomService.layer), Effect.provide(ServerCrypto.layer));

const deterministicCryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: () => Effect.die(new Error('Digest is not used by RoomService')),
  }),
);

const withDeterministicRoomService = <A, E, R>(effect: Effect.Effect<A, E, R | RoomService>) =>
  effect.pipe(Effect.provide(RoomService.layer), Effect.provide(deterministicCryptoLayer));

const requireOpenedEvent = (event: unknown): RoomSessionOpenedEvent => {
  assert.instanceOf(event, RoomSessionOpenedEvent);
  return event as RoomSessionOpenedEvent;
};

const isOpened = (event: { readonly _tag: string }) =>
  event._tag === '@tether/RoomSessionOpenedEvent';

// Opens a host session and returns its minted roomId, keeping the room alive
// via a forked drain fiber for the rest of the test.
const openHostRoomId = Effect.fnUntraced(function* (self: PeerId) {
  const room = yield* RoomService;
  const roomIdDeferred = yield* Deferred.make<RoomId>();
  const stream = yield* room.host(self);
  yield* stream.pipe(
    Stream.tap((event) =>
      isOpened(event)
        ? Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId)
        : Effect.void,
    ),
    Stream.runDrain,
    Effect.forkChild({ startImmediately: true }),
  );
  return yield* Deferred.await(roomIdDeferred);
});

// Drives alice (host) + bob (join, allowed) to a connected room. The host and
// joiner streams are collected by forked fibers of the requested lengths.
const connect = Effect.fnUntraced(function* (options: {
  readonly hostTake: number;
  readonly joinerTake: number;
}) {
  const room = yield* RoomService;
  const roomIdDeferred = yield* Deferred.make<RoomId>();
  const aliceTokenDeferred = yield* Deferred.make<string>();
  const bobTokenDeferred = yield* Deferred.make<string>();

  const aliceStream = yield* room.host(alice);
  const aliceFiber = yield* aliceStream.pipe(
    Stream.tap((event) =>
      isOpened(event)
        ? Effect.all([
            Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId),
            Deferred.succeed(aliceTokenDeferred, (event as RoomSessionOpenedEvent).sessionToken),
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
      isOpened(event)
        ? Deferred.succeed(bobTokenDeferred, (event as RoomSessionOpenedEvent).sessionToken)
        : Effect.void,
    ),
    Stream.take(options.joinerTake),
    Stream.runCollect,
    Effect.forkChild({ startImmediately: true }),
  );

  yield* room.respondToJoin(roomId, alice, aliceToken, bob, 'allow');
  const bobToken = yield* Deferred.await(bobTokenDeferred);

  return { roomId, aliceToken, bobToken, aliceFiber, bobFiber };
});

const offer = (sdp: string) =>
  new SessionDescriptionSignal({ negotiationEpoch: 0, type: 'offer', sdp });

describe('RoomService knock-to-join', () => {
  it.effect('mints a room id and surfaces a knock to the host', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();

        const aliceStream = yield* room.host(alice);
        const aliceFiber = yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId)
              : Effect.void,
          ),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );

        const roomId = yield* Deferred.await(roomIdDeferred);
        assert.match(roomId, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);

        const bobStream = yield* room.join(roomId, bob, bobName);
        const bobEvents = yield* bobStream.pipe(Stream.take(1), Stream.runCollect);
        const aliceEvents = yield* Fiber.join(aliceFiber);
        const aliceOpened = requireOpenedEvent(aliceEvents[0]);

        assert.strictEqual(aliceOpened.roomId, roomId);
        assert.strictEqual(aliceOpened.peerId, null);
        assert.deepStrictEqual(
          aliceEvents[1],
          new JoinRequestedEvent({ peerId: bob, displayName: bobName }),
        );
        assert.deepStrictEqual(bobEvents, [new JoinPendingEvent({})]);
      }),
    ),
  );

  it.effect('admits a joiner the host allows and connects both peers', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const { roomId, aliceToken, bobToken, aliceFiber, bobFiber } = yield* connect({
          hostTake: 3,
          joinerTake: 2,
        });

        const bobEvents = yield* Fiber.join(bobFiber);
        const bobOpened = requireOpenedEvent(bobEvents[1]);

        assert.deepStrictEqual(bobEvents[0], new JoinPendingEvent({}));
        assert.strictEqual(bobOpened.peerId, alice);
        assert.strictEqual(bobOpened.roomId, roomId);
        assert.notStrictEqual(aliceToken, bobToken);

        // Both admitted members can signal without error.
        yield* room.sendSignal(roomId, alice, aliceToken, offer('from-alice'));
        yield* room.sendSignal(roomId, bob, bobToken, offer('from-bob'));

        const aliceEvents = yield* Fiber.join(aliceFiber);
        assert.deepStrictEqual(aliceEvents[2], new PeerJoinedEvent({ peerId: bob }));
      }),
    ),
  );

  it.effect('subscribes an admitted joiner before exposing the opened event', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();
        const aliceTokenDeferred = yield* Deferred.make<string>();
        const bobOpenedDeferred = yield* Deferred.make<void>();

        const aliceStream = yield* room.host(alice);
        yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Effect.all([
                  Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId),
                  Deferred.succeed(
                    aliceTokenDeferred,
                    (event as RoomSessionOpenedEvent).sessionToken,
                  ),
                ])
              : Effect.void,
          ),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );

        const roomId = yield* Deferred.await(roomIdDeferred);
        const aliceToken = yield* Deferred.await(aliceTokenDeferred);
        const bobStream = yield* room.join(roomId, bob, bobName);
        const bobFiber = yield* bobStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? room
                  .sendSignal(roomId, alice, aliceToken, offer('immediate-answer'))
                  .pipe(Effect.andThen(Deferred.succeed(bobOpenedDeferred, undefined)))
              : Effect.void,
          ),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );

        yield* room.respondToJoin(roomId, alice, aliceToken, bob, 'allow');
        yield* Deferred.await(bobOpenedDeferred);
        yield* Effect.yieldNow;
        yield* room.sendSignal(roomId, alice, aliceToken, offer('later-answer'));

        const bobEvents = yield* Fiber.join(bobFiber);
        assert.deepStrictEqual(
          bobEvents[2],
          new SignalReceivedEvent({ peerId: alice, signal: offer('immediate-answer') }),
        );
      }),
    ),
  );

  it.effect('denies an admitted stream if its room disappears before it opens', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();
        const aliceTokenDeferred = yield* Deferred.make<string>();
        const aliceScope = yield* Scope.make();
        const bobScope = yield* Scope.make();

        const aliceStream = yield* room.host(alice).pipe(Scope.provide(aliceScope));
        yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Effect.all([
                  Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId),
                  Deferred.succeed(
                    aliceTokenDeferred,
                    (event as RoomSessionOpenedEvent).sessionToken,
                  ),
                ])
              : Effect.void,
          ),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );

        const roomId = yield* Deferred.await(roomIdDeferred);
        const aliceToken = yield* Deferred.await(aliceTokenDeferred);
        const bobStream = yield* room.join(roomId, bob, bobName).pipe(Scope.provide(bobScope));

        yield* room.respondToJoin(roomId, alice, aliceToken, bob, 'allow');
        yield* Scope.close(aliceScope, Exit.void);
        yield* Scope.close(bobScope, Exit.void);

        const error = yield* bobStream.pipe(Stream.drop(1), Stream.runDrain, Effect.flip);
        assert.instanceOf(error, JoinDenied);
      }),
    ),
  );

  it.effect('fails the joiner stream when the host denies', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();
        const aliceTokenDeferred = yield* Deferred.make<string>();

        const aliceStream = yield* room.host(alice);
        yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Effect.all([
                  Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId),
                  Deferred.succeed(
                    aliceTokenDeferred,
                    (event as RoomSessionOpenedEvent).sessionToken,
                  ),
                ])
              : Effect.void,
          ),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        const roomId = yield* Deferred.await(roomIdDeferred);
        const aliceToken = yield* Deferred.await(aliceTokenDeferred);

        const bobStream = yield* room.join(roomId, bob, bobName);
        const bobFiber = yield* bobStream.pipe(
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );

        yield* room.respondToJoin(roomId, alice, aliceToken, bob, 'deny');
        const error = yield* Fiber.join(bobFiber).pipe(Effect.flip);
        assert.instanceOf(error, JoinDenied);

        // The room still has the host: a fresh knock reaches pending.
        const charlieStream = yield* room.join(roomId, charlie, charlieName);
        const charlieFirst = yield* charlieStream.pipe(Stream.take(1), Stream.runCollect);
        assert.instanceOf(charlieFirst[0], JoinPendingEvent);
      }),
    ),
  );

  it.effect('denies a knock that goes unanswered past the timeout', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();
        const aliceTokenDeferred = yield* Deferred.make<string>();

        const aliceStream = yield* room.host(alice);
        yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Effect.all([
                  Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId),
                  Deferred.succeed(
                    aliceTokenDeferred,
                    (event as RoomSessionOpenedEvent).sessionToken,
                  ),
                ])
              : Effect.void,
          ),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        const roomId = yield* Deferred.await(roomIdDeferred);
        const aliceToken = yield* Deferred.await(aliceTokenDeferred);

        const bobStream = yield* room.join(roomId, bob, bobName);
        const bobFiber = yield* bobStream.pipe(
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );

        yield* TestClock.adjust('60 seconds');
        const error = yield* Fiber.join(bobFiber).pipe(Effect.flip);
        assert.instanceOf(error, JoinDenied);

        // Pending was cleared: answering the timed-out knock finds nothing.
        const noPending = yield* room
          .respondToJoin(roomId, alice, aliceToken, bob, 'allow')
          .pipe(Effect.flip);
        assert.instanceOf(noPending, NoPendingJoin);
      }),
    ),
  );

  it.effect('cleans up safely when two consumers observe the same knock timing out', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomId = yield* openHostRoomId(alice);
        const bobStream = yield* room.join(roomId, bob, bobName);
        const firstFiber = yield* bobStream.pipe(
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        const secondFiber = yield* bobStream.pipe(
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );

        yield* TestClock.adjust('60 seconds');

        assert.instanceOf(yield* Fiber.join(firstFiber).pipe(Effect.flip), JoinDenied);
        assert.instanceOf(yield* Fiber.join(secondFiber).pipe(Effect.flip), JoinDenied);
      }),
    ),
  );

  it.effect('rejects a join for a room without a host and creates nothing', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomId = RoomId.make('zzz-zzzz-zzz');

        const error = yield* room.join(roomId, bob, bobName).pipe(Effect.flip);
        assert.instanceOf(error, RoomNotFound);

        // A second attempt still fails: the first did not squat a room.
        const again = yield* room.join(roomId, charlie, charlieName).pipe(Effect.flip);
        assert.instanceOf(again, RoomNotFound);
      }),
    ),
  );

  it.effect('does not relay signals from a pending joiner', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomId = yield* openHostRoomId(alice);

        const bobStream = yield* room.join(roomId, bob, bobName);
        yield* bobStream.pipe(Stream.take(1), Stream.runCollect);

        const error = yield* room
          .sendSignal(roomId, bob, 'not-a-member-token', offer('sneaky'))
          .pipe(Effect.flip);
        assert.instanceOf(error, PeerNotInRoom);
        assert.strictEqual(error.peerId, bob);
      }),
    ),
  );

  it.effect('denies pending joiners when the host leaves', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();
        const aliceScope = yield* Scope.make();

        const aliceStream = yield* room.host(alice).pipe(Scope.provide(aliceScope));
        yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId)
              : Effect.void,
          ),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        const roomId = yield* Deferred.await(roomIdDeferred);

        const bobStream = yield* room.join(roomId, bob, bobName);
        const bobFiber = yield* bobStream.pipe(
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        // Ensure the knock is registered before the host departs.
        yield* Effect.yieldNow;

        yield* Scope.close(aliceScope, Exit.void);
        const denied = yield* Fiber.join(bobFiber).pipe(Effect.flip);
        assert.instanceOf(denied, JoinDenied);

        const notFound = yield* room.join(roomId, charlie, charlieName).pipe(Effect.flip);
        assert.instanceOf(notFound, RoomNotFound);
      }),
    ),
  );

  it.effect('authenticates RespondToJoin and requires a pending peer', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();
        const aliceTokenDeferred = yield* Deferred.make<string>();

        const aliceStream = yield* room.host(alice);
        yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Effect.all([
                  Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId),
                  Deferred.succeed(
                    aliceTokenDeferred,
                    (event as RoomSessionOpenedEvent).sessionToken,
                  ),
                ])
              : Effect.void,
          ),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        const roomId = yield* Deferred.await(roomIdDeferred);
        const aliceToken = yield* Deferred.await(aliceTokenDeferred);

        const bobStream = yield* room.join(roomId, bob, bobName);
        yield* bobStream.pipe(Stream.take(1), Stream.runCollect);

        const wrongToken = yield* room
          .respondToJoin(roomId, alice, 'wrong-session-token', bob, 'allow')
          .pipe(Effect.flip);
        assert.instanceOf(wrongToken, PeerNotInRoom);
        assert.strictEqual(wrongToken.peerId, alice);

        const noPending = yield* room
          .respondToJoin(roomId, alice, aliceToken, charlie, 'allow')
          .pipe(Effect.flip);
        assert.instanceOf(noPending, NoPendingJoin);
        assert.strictEqual(noPending.peerId, charlie);
      }),
    ),
  );

  it.effect('drops a pending joiner that disconnects before admission', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();
        const aliceTokenDeferred = yield* Deferred.make<string>();

        const aliceStream = yield* room.host(alice);
        yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Effect.all([
                  Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId),
                  Deferred.succeed(
                    aliceTokenDeferred,
                    (event as RoomSessionOpenedEvent).sessionToken,
                  ),
                ])
              : Effect.void,
          ),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        const roomId = yield* Deferred.await(roomIdDeferred);
        const aliceToken = yield* Deferred.await(aliceTokenDeferred);

        const bobScope = yield* Scope.make();
        const bobStream = yield* room.join(roomId, bob, bobName).pipe(Scope.provide(bobScope));
        yield* bobStream.pipe(Stream.take(1), Stream.runCollect, Scope.provide(bobScope));
        yield* Scope.close(bobScope, Exit.void);

        const noPending = yield* room
          .respondToJoin(roomId, alice, aliceToken, bob, 'allow')
          .pipe(Effect.flip);
        assert.instanceOf(noPending, NoPendingJoin);
      }),
    ),
  );

  it.effect('tells the host when a pending knock times out', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();

        const aliceStream = yield* room.host(alice);
        const aliceFiber = yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId)
              : Effect.void,
          ),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        const roomId = yield* Deferred.await(roomIdDeferred);

        const bobStream = yield* room.join(roomId, bob, bobName);
        const bobFiber = yield* bobStream.pipe(
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );

        yield* TestClock.adjust('60 seconds');
        yield* Fiber.join(bobFiber).pipe(Effect.flip);

        const aliceEvents = yield* Fiber.join(aliceFiber);
        assert.deepStrictEqual(
          aliceEvents[1],
          new JoinRequestedEvent({ peerId: bob, displayName: bobName }),
        );
        assert.deepStrictEqual(aliceEvents[2], new JoinCancelledEvent({ peerId: bob }));
      }),
    ),
  );

  it.effect('tells the host when a pending joiner disconnects', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();

        const aliceStream = yield* room.host(alice);
        const aliceFiber = yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId)
              : Effect.void,
          ),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        const roomId = yield* Deferred.await(roomIdDeferred);

        const bobScope = yield* Scope.make();
        const bobStream = yield* room.join(roomId, bob, bobName).pipe(Scope.provide(bobScope));
        yield* bobStream.pipe(Stream.take(1), Stream.runCollect, Scope.provide(bobScope));
        yield* Scope.close(bobScope, Exit.void);

        const aliceEvents = yield* Fiber.join(aliceFiber);
        assert.deepStrictEqual(
          aliceEvents[1],
          new JoinRequestedEvent({ peerId: bob, displayName: bobName }),
        );
        assert.deepStrictEqual(aliceEvents[2], new JoinCancelledEvent({ peerId: bob }));
      }),
    ),
  );

  it.effect('denies a second pending knock once the first fills the room', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();
        const aliceTokenDeferred = yield* Deferred.make<string>();

        const aliceStream = yield* room.host(alice);
        yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Effect.all([
                  Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId),
                  Deferred.succeed(
                    aliceTokenDeferred,
                    (event as RoomSessionOpenedEvent).sessionToken,
                  ),
                ])
              : Effect.void,
          ),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        const roomId = yield* Deferred.await(roomIdDeferred);
        const aliceToken = yield* Deferred.await(aliceTokenDeferred);

        // Both knock while the room still has only the host.
        const bobStream = yield* room.join(roomId, bob, bobName);
        const bobFiber = yield* bobStream.pipe(
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        const charlieStream = yield* room.join(roomId, charlie, charlieName);
        const charlieFiber = yield* charlieStream.pipe(
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );

        // Admit the first, then admitting the second finds the room full.
        yield* room.respondToJoin(roomId, alice, aliceToken, bob, 'allow');
        yield* room.respondToJoin(roomId, alice, aliceToken, charlie, 'allow');

        const streamFailure = yield* Fiber.join(charlieFiber).pipe(Effect.flip);
        assert.instanceOf(streamFailure, JoinDenied);
        yield* Fiber.interrupt(bobFiber);
      }),
    ),
  );

  it.effect('rejects a third peer once the room is full', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const { roomId } = yield* connect({ hostTake: 3, joinerTake: 2 });

        const error = yield* room.join(roomId, charlie, charlieName).pipe(Effect.flip);
        assert.instanceOf(error, RoomFull);
      }),
    ),
  );
});

describe('RoomService signalling', () => {
  it.effect('delivers signals to the peer in FIFO order', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const { roomId, bobToken, aliceFiber } = yield* connect({ hostTake: 6, joinerTake: 2 });

        const signals = ['one', 'two', 'three'].map(offer);
        yield* Effect.forEach(signals, (signal) => room.sendSignal(roomId, bob, bobToken, signal));

        const aliceEvents = yield* Fiber.join(aliceFiber);
        assert.deepStrictEqual(
          aliceEvents.filter((event) => event instanceof SignalReceivedEvent),
          signals.map((signal) => new SignalReceivedEvent({ peerId: bob, signal })),
        );
      }),
    ),
  );

  it.effect('silently drops signals beyond the member rate limit', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const { roomId, bobToken, aliceFiber } = yield* connect({
          hostTake: 3 + SIGNAL_BUCKET_CAPACITY,
          joinerTake: 2,
        });

        yield* Effect.forEach(Array.from({ length: SIGNAL_BUCKET_CAPACITY + 10 }), () =>
          room.sendSignal(roomId, bob, bobToken, offer('flood')),
        );

        const aliceEvents = yield* Fiber.join(aliceFiber);
        assert.lengthOf(
          aliceEvents.filter((event) => event instanceof SignalReceivedEvent),
          SIGNAL_BUCKET_CAPACITY,
        );
      }),
    ),
  );

  it.effect('maintains a separate signal bucket for each member', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const { roomId, aliceToken, bobToken, aliceFiber } = yield* connect({
          hostTake: 4,
          joinerTake: 2,
        });

        // Drain alice's bucket, then a single bob signal must still arrive.
        yield* Effect.forEach(Array.from({ length: SIGNAL_BUCKET_CAPACITY }), () =>
          room.sendSignal(roomId, alice, aliceToken, offer('alice')),
        );
        yield* room.sendSignal(roomId, bob, bobToken, offer('bob'));

        const aliceEvents = yield* Fiber.join(aliceFiber);
        assert.deepStrictEqual(
          aliceEvents.filter((event) => event instanceof SignalReceivedEvent),
          [new SignalReceivedEvent({ peerId: bob, signal: offer('bob') })],
        );
      }),
    ),
  );

  it.effect('rejects forged signals while accepting the member token', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const { roomId, aliceToken } = yield* connect({ hostTake: 3, joinerTake: 2 });

        const error = yield* room
          .sendSignal(roomId, alice, 'wrong-session-token', offer('forged'))
          .pipe(Effect.flip);
        yield* room.sendSignal(roomId, alice, aliceToken, offer('authentic'));

        assert.instanceOf(error, PeerNotInRoom);
        assert.strictEqual(error.peerId, alice);
      }),
    ),
  );

  it.effect('issues distinct non-empty session tokens to each member', () =>
    withRoomService(
      Effect.gen(function* () {
        const { aliceToken, bobToken } = yield* connect({ hostTake: 3, joinerTake: 2 });
        assert.isNotEmpty(aliceToken);
        assert.isNotEmpty(bobToken);
        assert.notStrictEqual(aliceToken, bobToken);
      }),
    ),
  );

  it.effect('lets an admitted peer leave and notifies the host', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const { roomId, bobToken, aliceFiber } = yield* connect({ hostTake: 4, joinerTake: 2 });

        yield* room.leave(roomId, bob, bobToken);

        const aliceEvents = yield* Fiber.join(aliceFiber);
        assert.deepStrictEqual(aliceEvents[3], new PeerLeftEvent({ peerId: bob }));
      }),
    ),
  );

  it.effect('ignores a leave request with the wrong session token', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const { roomId, bobToken, aliceFiber } = yield* connect({ hostTake: 4, joinerTake: 2 });

        yield* room.leave(roomId, bob, 'wrong-session-token');
        yield* room.leave(roomId, bob, bobToken);

        const aliceEvents = yield* Fiber.join(aliceFiber);
        assert.deepStrictEqual(aliceEvents[3], new PeerLeftEvent({ peerId: bob }));
      }),
    ),
  );

  it.effect('removes an admitted member when its session scope closes', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomIdDeferred = yield* Deferred.make<RoomId>();
        const aliceTokenDeferred = yield* Deferred.make<string>();

        const aliceStream = yield* room.host(alice);
        const aliceFiber = yield* aliceStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Effect.all([
                  Deferred.succeed(roomIdDeferred, (event as RoomSessionOpenedEvent).roomId),
                  Deferred.succeed(
                    aliceTokenDeferred,
                    (event as RoomSessionOpenedEvent).sessionToken,
                  ),
                ])
              : Effect.void,
          ),
          Stream.take(4),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        const roomId = yield* Deferred.await(roomIdDeferred);
        const aliceToken = yield* Deferred.await(aliceTokenDeferred);

        const bobScope = yield* Scope.make();
        const bobTokenDeferred = yield* Deferred.make<string>();
        const bobStream = yield* room.join(roomId, bob, bobName).pipe(Scope.provide(bobScope));
        yield* bobStream.pipe(
          Stream.tap((event) =>
            isOpened(event)
              ? Deferred.succeed(bobTokenDeferred, (event as RoomSessionOpenedEvent).sessionToken)
              : Effect.void,
          ),
          Stream.runDrain,
          Scope.provide(bobScope),
          Effect.forkChild({ startImmediately: true }),
        );

        yield* room.respondToJoin(roomId, alice, aliceToken, bob, 'allow');
        yield* Deferred.await(bobTokenDeferred);
        yield* Scope.close(bobScope, Exit.void);

        const aliceEvents = yield* Fiber.join(aliceFiber);
        assert.deepStrictEqual(aliceEvents[3], new PeerLeftEvent({ peerId: bob }));
      }),
    ),
  );
});

describe('RoomService capacity', () => {
  it.effect('rejects a room after exhausting colliding minted ids', () =>
    withDeterministicRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        yield* room.host(alice);

        const error = yield* room.host(bob).pipe(Effect.flip);
        assert.instanceOf(error, ServerAtCapacity);
      }),
    ),
  );

  it.effect('rejects new rooms once the creation bucket is drained', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;

        yield* Effect.forEach(
          Array.from({ length: ROOM_CREATE_BUCKET_CAPACITY }, (_, index) => index),
          (index) => room.host(randomPeerId(index)),
          { discard: true },
        );

        const error = yield* room.host(randomPeerId(ROOM_CREATE_BUCKET_CAPACITY)).pipe(Effect.flip);
        assert.instanceOf(error, ServerAtCapacity);
      }),
    ),
  );

  it.effect('refills the room-creation bucket over time', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;

        yield* Effect.forEach(
          Array.from({ length: ROOM_CREATE_BUCKET_CAPACITY }, (_, index) => index),
          (index) => room.host(randomPeerId(index)),
          { discard: true },
        );

        const rejected = yield* room.host(randomPeerId(100)).pipe(Effect.flip);
        assert.instanceOf(rejected, ServerAtCapacity);

        yield* TestClock.adjust(ROOM_CREATE_BUCKET_REFILL_EVERY);

        const events = yield* room.host(randomPeerId(101));
        const opened = requireOpenedEvent(
          (yield* events.pipe(Stream.take(1), Stream.runCollect))[0],
        );
        assert.match(opened.roomId, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
      }),
    ),
  );

  it.effect('allows joining an existing room when the creation bucket is empty', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomId = yield* openHostRoomId(alice);

        yield* Effect.forEach(
          Array.from({ length: ROOM_CREATE_BUCKET_CAPACITY - 1 }, (_, index) => index),
          (index) => room.host(randomPeerId(index)),
          { discard: true },
        );

        const rejected = yield* room.host(randomPeerId(500)).pipe(Effect.flip);
        assert.instanceOf(rejected, ServerAtCapacity);

        const joinerStream = yield* room.join(roomId, bob, bobName);
        const first = yield* joinerStream.pipe(Stream.take(1), Stream.runCollect);
        assert.instanceOf(first[0], JoinPendingEvent);
      }),
    ),
  );

  it.effect('caps new rooms while allowing joins to existing rooms', () =>
    withRoomService(
      Effect.gen(function* () {
        const room = yield* RoomService;
        const roomId = yield* openHostRoomId(alice);

        yield* Effect.forEach(
          Array.from({ length: MAX_LIVE_ROOMS - 1 }, (_, index) => index),
          (index) =>
            room
              .host(randomPeerId(index))
              .pipe(Effect.tap(() => TestClock.adjust(ROOM_CREATE_BUCKET_REFILL_EVERY))),
          { discard: true },
        );

        const error = yield* room.host(randomPeerId(9999)).pipe(Effect.flip);
        assert.instanceOf(error, ServerAtCapacity);

        const joinerStream = yield* room.join(roomId, bob, bobName);
        const first = yield* joinerStream.pipe(Stream.take(1), Stream.runCollect);
        assert.instanceOf(first[0], JoinPendingEvent);
      }),
    ),
  );
});

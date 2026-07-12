import { assert, describe, it } from '@effect/vitest';
import {
  DisplayName,
  JoinDenied,
  PeerAlreadyJoined,
  PeerId,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomEvent,
  RoomFull,
  RoomId,
  RoomNotFound,
  RoomRpcs,
  RoomSessionOpenedEvent,
  ServerAtCapacity,
  SessionToken,
  SessionDescriptionSignal,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from 'effect';
import { RpcTest } from 'effect/unstable/rpc';

import * as ServerCrypto from '@/lib/ServerCrypto';

import { ROOM_CREATE_BUCKET_CAPACITY } from './Constants';
import { RoomHandlers } from './Handlers';
import { RoomService } from './RoomService';

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

const TestHandlers = RoomHandlers.pipe(
  Layer.provide(RoomService.layer),
  Layer.provide(ServerCrypto.layer),
);
const makeClient = RpcTest.makeClient(RoomRpcs).pipe(Effect.provide(TestHandlers));

type Client = Effect.Success<typeof makeClient>;

const isTag = (entry: { readonly event: { readonly _tag: string } }, tag: string) =>
  entry.event._tag === tag;

// Hosts alice, knocks as bob, waits for the host to observe the knock, then
// admits bob. Returns the ids/tokens and the still-running host/joiner fibers.
const connect = (
  client: Client,
  options: { readonly hostTake?: number; readonly joinerTake?: number } = {},
) =>
  Effect.gen(function* () {
    const roomIdDeferred = yield* Deferred.make<RoomId>();
    const aliceTokenDeferred = yield* Deferred.make<SessionToken>();
    const knockDeferred = yield* Deferred.make<void>();
    const bobTokenDeferred = yield* Deferred.make<SessionToken>();

    const hostStream = client.OpenRoomSession({ selfId: alice, intent: 'host' });
    const aliceFiber = yield* (
      options.hostTake === undefined
        ? hostStream.pipe(Stream.tap(hostTap), Stream.runDrain)
        : hostStream.pipe(Stream.tap(hostTap), Stream.take(options.hostTake), Stream.runCollect)
    ).pipe(Effect.forkChild({ startImmediately: true }));

    const roomId = yield* Deferred.await(roomIdDeferred);
    const aliceToken = yield* Deferred.await(aliceTokenDeferred);

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

    // Callers that read the collected events always pass hostTake; drain-path
    // callers ignore the fiber, so surface the collect result to both.
    return {
      roomId,
      aliceToken,
      bobToken,
      aliceFiber: aliceFiber as Fiber.Fiber<ReadonlyArray<{ readonly event: RoomEvent }>>,
      bobFiber,
    };

    function hostTap(entry: { readonly event: { readonly _tag: string } }) {
      if (isTag(entry, '@tether/RoomSessionOpenedEvent')) {
        const opened = entry.event as RoomSessionOpenedEvent;
        return Effect.all([
          Deferred.succeed(roomIdDeferred, opened.roomId),
          Deferred.succeed(aliceTokenDeferred, opened.sessionToken),
        ]);
      }
      if (isTag(entry, '@tether/JoinRequestedEvent')) {
        return Deferred.succeed(knockDeferred, undefined);
      }
      return Effect.void;
    }

    function bobTap(entry: { readonly event: { readonly _tag: string } }) {
      return isTag(entry, '@tether/RoomSessionOpenedEvent')
        ? Deferred.succeed(bobTokenDeferred, (entry.event as RoomSessionOpenedEvent).sessionToken)
        : Effect.void;
    }
  });

describe('RoomHandlers', () => {
  it.effect('relays a departure when the joiner stream closes', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const { aliceFiber, bobFiber } = yield* connect(client, { hostTake: 4, joinerTake: 2 });

      // Bob's stream completes after [JoinPending, RoomSessionOpened], closing
      // the session, which the host observes as a departure.
      yield* Fiber.join(bobFiber);
      const aliceEvents = yield* Fiber.join(aliceFiber);

      assert.deepStrictEqual(aliceEvents[3], { event: new PeerLeftEvent({ peerId: bob }) });
    }),
  );

  it.effect('explicitly leaves through the RPC', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const { roomId, bobToken, aliceFiber } = yield* connect(client, { hostTake: 4 });

      yield* client.LeaveRoom({ roomId, selfId: bob, sessionToken: bobToken });
      const aliceEvents = yield* Fiber.join(aliceFiber);

      assert.deepStrictEqual(aliceEvents[3], { event: new PeerLeftEvent({ peerId: bob }) });
    }),
  );

  it.effect('relays a signal to the other peer', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const { roomId, bobToken, aliceFiber } = yield* connect(client, { hostTake: 4 });

      const signal = new SessionDescriptionSignal({
        negotiationEpoch: 7,
        type: 'offer',
        sdp: 'relayed-offer',
      });
      yield* client.SendSignal({ roomId, selfId: bob, sessionToken: bobToken, signal });

      const aliceEvents = yield* Fiber.join(aliceFiber);
      assert.deepStrictEqual(aliceEvents[3], {
        event: new SignalReceivedEvent({ peerId: bob, signal }),
      });
    }),
  );

  it.effect('does not relay signals from a peer outside the room', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const { roomId } = yield* connect(client);

      const error = yield* client
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
      const client = yield* makeClient;
      const { roomId } = yield* connect(client);

      const error = yield* client
        .OpenRoomSession({ selfId: charlie, intent: 'join', roomId, displayName: charlieName })
        .pipe(Stream.runDrain, Effect.flip);

      assert.instanceOf(error, RoomFull);
      assert.strictEqual(error.roomId, roomId);
    }),
  );

  it.effect('returns RoomNotFound for a join to an unknown room', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;

      const error = yield* client
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

  it.effect('returns ServerAtCapacity when the creation bucket is drained', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;

      yield* Effect.forEach(
        Array.from({ length: ROOM_CREATE_BUCKET_CAPACITY }, (_, index) => index),
        (index) =>
          client
            .OpenRoomSession({ selfId: randomPeerId(index), intent: 'host' })
            .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true })),
        { discard: true },
      );

      const error = yield* client
        .OpenRoomSession({ selfId: randomPeerId(999), intent: 'host' })
        .pipe(Stream.runDrain, Effect.flip);

      assert.instanceOf(error, ServerAtCapacity);
    }),
  );

  it.effect('returns PeerAlreadyJoined when a member rejoins', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const { roomId } = yield* connect(client);

      const error = yield* client
        .OpenRoomSession({ selfId: bob, intent: 'join', roomId, displayName: bobName })
        .pipe(Stream.runDrain, Effect.flip);

      assert.instanceOf(error, PeerAlreadyJoined);
      assert.strictEqual(error.peerId, bob);
    }),
  );

  it.effect('denies a joiner through RespondToJoin', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const roomIdDeferred = yield* Deferred.make<RoomId>();
      const aliceTokenDeferred = yield* Deferred.make<SessionToken>();
      const knockDeferred = yield* Deferred.make<void>();

      yield* client.OpenRoomSession({ selfId: alice, intent: 'host' }).pipe(
        Stream.tap((entry) => {
          if (isTag(entry, '@tether/RoomSessionOpenedEvent')) {
            const opened = entry.event as RoomSessionOpenedEvent;
            return Effect.all([
              Deferred.succeed(roomIdDeferred, opened.roomId),
              Deferred.succeed(aliceTokenDeferred, opened.sessionToken),
            ]);
          }
          return isTag(entry, '@tether/JoinRequestedEvent')
            ? Deferred.succeed(knockDeferred, undefined)
            : Effect.void;
        }),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      );
      const roomId = yield* Deferred.await(roomIdDeferred);
      const aliceToken = yield* Deferred.await(aliceTokenDeferred);

      const bobFiber = yield* client
        .OpenRoomSession({ selfId: bob, intent: 'join', roomId, displayName: bobName })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      yield* Deferred.await(knockDeferred);
      yield* client.RespondToJoin({
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
      const client = yield* makeClient;
      const { roomId } = yield* connect(client);

      const error = yield* client
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

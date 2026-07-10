import {
  JoinCancelledEvent,
  JoinDenied,
  JoinPendingEvent,
  JoinRequestedEvent,
  NoPendingJoin,
  PeerAlreadyJoined,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomFull,
  RoomNotFound,
  RoomSessionOpenedEvent,
  ServerAtCapacity,
  SignalReceivedEvent,
  RoomId,
  type DisplayName,
  type PeerId,
  type RoomEvent,
  type Signal,
} from '@tether/contracts/modules/room';
import { Context, Crypto, Deferred, Effect, Layer, PubSub, Stream, SynchronizedRef } from 'effect';

import { makeTokenBucket, type TokenBucket } from '@/lib/TokenBucket';

import {
  JOIN_REQUEST_TIMEOUT,
  MAX_LIVE_ROOMS,
  ROOM_CREATE_BUCKET_CAPACITY,
  ROOM_CREATE_BUCKET_REFILL_EVERY,
  ROOM_ID_MINT_ATTEMPTS,
  SIGNAL_BUCKET_CAPACITY,
  SIGNAL_BUCKET_REFILL_EVERY,
} from './Constants';

type Member = {
  readonly peerId: PeerId;
  readonly sessionToken: string;
  readonly signalBucket: TokenBucket;
};

type AdmitResult = {
  readonly sessionToken: string;
  readonly hostPeerId: PeerId;
  readonly subscription: PubSub.Subscription<BroadcastRoomEvent>;
};

type PendingJoin = {
  readonly peerId: PeerId;
  readonly displayName: DisplayName;
  readonly deferred: Deferred.Deferred<AdmitResult, JoinDenied>;
  readonly subscription: PubSub.Subscription<BroadcastRoomEvent>;
};

type BroadcastRoomEvent = Exclude<RoomEvent, JoinPendingEvent>;

type RoomCtx = {
  members: Member[];
  pending: PendingJoin[];
  readonly pubsub: PubSub.PubSub<BroadcastRoomEvent>;
};
// Registry writes are serialized by SynchronizedRef, so updater bodies mutate ctx
// in place; the `new Map(registry)` copy matters only where a key is added or
// removed (tryCreateRoom, removeMember), which is why removePending skips it.
type Registry = Map<RoomId, RoomCtx>;

// modifyEffect infers its result type from the first `return`, so every branch is
// annotated with the shared union to fix that inference and read consistently.
type CreateOutcome =
  | { readonly _tag: 'collision' }
  | { readonly _tag: 'rejected' }
  | { readonly _tag: 'created'; readonly events: Stream.Stream<RoomEvent> };

type JoinOutcome =
  | { readonly _tag: 'not-found' }
  | { readonly _tag: 'already-joined' }
  | { readonly _tag: 'full' }
  | { readonly _tag: 'pending' };

type RespondAction =
  | { readonly _tag: 'not-member' }
  | { readonly _tag: 'no-pending' }
  | { readonly _tag: 'deny'; readonly deferred: Deferred.Deferred<AdmitResult, JoinDenied> }
  | {
      readonly _tag: 'allow';
      readonly deferred: Deferred.Deferred<AdmitResult, JoinDenied>;
      readonly result: AdmitResult;
    };

const notSelf = (selfId: PeerId) => (event: BroadcastRoomEvent) => event.peerId !== selfId;

export class RoomService extends Context.Service<RoomService>()('@tether/RoomService', {
  make: Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    // A crypto random-source failure is a defect, not a recoverable domain error,
    // so orDie keeps PlatformError out of the service's public error channels.
    const randomSessionToken = crypto.randomUUIDv4.pipe(Effect.orDie);
    const registryRef = yield* SynchronizedRef.make<Registry>(new Map());
    const roomCreateBucket = yield* makeTokenBucket({
      capacity: ROOM_CREATE_BUCKET_CAPACITY,
      refillEvery: ROOM_CREATE_BUCKET_REFILL_EVERY,
    });
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

    const randomCode = Effect.fnUntraced(function* (length: number) {
      const bytes = yield* crypto.randomBytes(length);
      return Array.from(bytes, (byte) => ALPHABET[byte % 26]).join('');
    });

    const generateRoomId = Effect.gen(function* () {
      return `${yield* randomCode(3)}-${yield* randomCode(4)}-${yield* randomCode(3)}`;
    }).pipe(Effect.orDie);

    // A knock withdrawn before a decision (timeout) tells the host to clear its
    // prompt. Disconnects go through removeMember, which broadcasts the same event.
    const removePending = (roomId: RoomId, peerId: PeerId) =>
      SynchronizedRef.updateEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const ctx = registry.get(roomId);
          if (ctx !== undefined && ctx.pending.some((entry) => entry.peerId === peerId)) {
            ctx.pending = ctx.pending.filter((entry) => entry.peerId !== peerId);
            yield* PubSub.publish(ctx.pubsub, new JoinCancelledEvent({ peerId }));
          }
          return registry;
        }),
      );

    const removeMember = Effect.fnUntraced(function* (
      roomId: RoomId,
      selfId: PeerId,
      sessionToken?: string,
    ) {
      const denied = yield* SynchronizedRef.modifyEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const newRegistry = new Map(registry);
          const ctx = newRegistry.get(roomId);

          if (ctx === undefined) {
            return [[] as PendingJoin[], newRegistry];
          }

          // A joiner that disconnects before admission is only ever in pending.
          if (ctx.pending.some((entry) => entry.peerId === selfId)) {
            ctx.pending = ctx.pending.filter((entry) => entry.peerId !== selfId);
            yield* PubSub.publish(ctx.pubsub, new JoinCancelledEvent({ peerId: selfId }));
            return [[], newRegistry];
          }

          const member = ctx.members.find((member) => member.peerId === selfId);

          if (member === undefined) {
            return [[], newRegistry];
          }

          if (sessionToken !== undefined && member.sessionToken !== sessionToken) {
            yield* Effect.logWarning('Leave rejected').pipe(
              Effect.annotateLogs('reason', 'invalid-session-token'),
            );
            return [[], newRegistry];
          }

          ctx.members = ctx.members.filter((member) => member.peerId !== selfId);

          yield* PubSub.publish(ctx.pubsub, new PeerLeftEvent({ peerId: selfId }));
          yield* Effect.logInfo('Room session closed').pipe(
            Effect.annotateLogs('occupancy', ctx.members.length),
          );

          if (ctx.members.length === 0) {
            newRegistry.delete(roomId);
            const toDeny = ctx.pending;
            ctx.pending = [];
            return [toDeny, newRegistry];
          }

          return [[], newRegistry];
        }),
      );

      // Complete deferreds outside the registry critical section.
      yield* Effect.forEach(denied, (entry) => Deferred.fail(entry.deferred, new JoinDenied()), {
        discard: true,
      });
    });

    const tryCreateRoom = (roomId: RoomId, selfId: PeerId) =>
      SynchronizedRef.modifyEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const newRegistry = new Map(registry);

          if (newRegistry.has(roomId)) {
            return [{ _tag: 'collision' } as CreateOutcome, newRegistry];
          }

          if (newRegistry.size >= MAX_LIVE_ROOMS) {
            yield* Effect.logWarning('Room join rejected').pipe(
              Effect.annotateLogs('reason', 'server-at-capacity'),
            );
            return [{ _tag: 'rejected' } as CreateOutcome, newRegistry];
          }

          const allowed = yield* roomCreateBucket.tryTake;
          if (!allowed) {
            yield* Effect.logWarning('Room join rejected').pipe(
              Effect.annotateLogs('reason', 'room-creation-rate-limited'),
            );
            return [{ _tag: 'rejected' } as CreateOutcome, newRegistry];
          }

          const pubsub = yield* PubSub.unbounded<BroadcastRoomEvent>();
          const subscription = yield* PubSub.subscribe(pubsub);
          const signalBucket = yield* makeTokenBucket({
            capacity: SIGNAL_BUCKET_CAPACITY,
            refillEvery: SIGNAL_BUCKET_REFILL_EVERY,
          });
          const sessionToken = yield* randomSessionToken;

          newRegistry.set(roomId, {
            members: [{ peerId: selfId, sessionToken, signalBucket }],
            pending: [],
            pubsub,
          });

          yield* Effect.logInfo('Room session opened').pipe(Effect.annotateLogs('occupancy', 1));

          const events = Stream.fromArray<BroadcastRoomEvent>([
            new RoomSessionOpenedEvent({ peerId: null, sessionToken, roomId }),
          ]).pipe(
            Stream.concat(Stream.fromSubscription(subscription)),
            Stream.filter(notSelf(selfId)),
          );

          return [{ _tag: 'created', events } as CreateOutcome, newRegistry];
        }),
      );

    const openHost = Effect.fnUntraced(function* (selfId: PeerId) {
      for (let attempt = 0; attempt < ROOM_ID_MINT_ATTEMPTS; attempt++) {
        const roomId = RoomId.make(yield* generateRoomId);
        const result = yield* tryCreateRoom(roomId, selfId);
        if (result._tag === 'created') {
          return { roomId, events: result.events };
        }
        if (result._tag === 'rejected') {
          return yield* new ServerAtCapacity();
        }
      }
      return yield* new ServerAtCapacity();
    });

    const host = Effect.fn('@tether/RoomService.host')(function* (selfId: PeerId) {
      const resource = yield* Effect.acquireRelease(openHost(selfId), (resource) =>
        removeMember(resource.roomId, selfId),
      );
      return resource.events;
    });

    // Uses the subscription established before admission was granted, ensuring no events are missed.
    const admittedStream = (roomId: RoomId, selfId: PeerId, result: AdmitResult) =>
      Stream.fromArray<BroadcastRoomEvent>([
        new RoomSessionOpenedEvent({
          peerId: result.hostPeerId,
          sessionToken: result.sessionToken,
          roomId,
        }),
      ]).pipe(
        Stream.concat(Stream.fromSubscription(result.subscription)),
        Stream.filter(notSelf(selfId)),
      );

    const openJoin = Effect.fnUntraced(function* (
      roomId: RoomId,
      selfId: PeerId,
      displayName: DisplayName,
    ) {
      const deferred = yield* Deferred.make<AdmitResult, JoinDenied>();

      // Subscribe before requesting to join, so the subscription is ready when admission is granted.
      const subscriptionResult = yield* SynchronizedRef.modifyEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const ctx = registry.get(roomId);
          if (ctx === undefined || ctx.members.length === 0) {
            return [
              { _tag: 'not-found', subscription: null } as const,
              registry,
            ];
          }
          const subscription = yield* PubSub.subscribe(ctx.pubsub);
          return [
            { _tag: 'found', subscription } as const,
            registry,
          ];
        }),
      );

      if (subscriptionResult._tag === 'not-found') {
        return yield* new RoomNotFound({ roomId });
      }

      const subscription = subscriptionResult.subscription;

      const outcome = yield* SynchronizedRef.modifyEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const newRegistry = new Map(registry);
          const ctx = newRegistry.get(roomId);

          if (ctx === undefined || ctx.members.length === 0) {
            return [{ _tag: 'not-found' } as JoinOutcome, newRegistry];
          }

          if (
            ctx.members.some((member) => member.peerId === selfId) ||
            ctx.pending.some((entry) => entry.peerId === selfId)
          ) {
            yield* Effect.logWarning('Room join rejected').pipe(
              Effect.annotateLogs('reason', 'peer-already-joined'),
            );
            return [{ _tag: 'already-joined' } as JoinOutcome, newRegistry];
          }

          if (ctx.members.length > 1) {
            yield* Effect.logWarning('Room join rejected').pipe(
              Effect.annotateLogs('reason', 'room-full'),
            );
            return [{ _tag: 'full' } as JoinOutcome, newRegistry];
          }

          ctx.pending = [...ctx.pending, { peerId: selfId, displayName, deferred, subscription }];
          yield* PubSub.publish(
            ctx.pubsub,
            new JoinRequestedEvent({ peerId: selfId, displayName }),
          );
          yield* Effect.logInfo('Join requested');

          return [{ _tag: 'pending' } as JoinOutcome, newRegistry];
        }),
      );

      if (outcome._tag === 'not-found') {
        return yield* new RoomNotFound({ roomId });
      }
      if (outcome._tag === 'already-joined') {
        return yield* new PeerAlreadyJoined({ roomId, peerId: selfId });
      }
      if (outcome._tag === 'full') {
        return yield* new RoomFull({ roomId });
      }

      const admitted = Deferred.await(deferred).pipe(
        Effect.timeoutOrElse({
          duration: JOIN_REQUEST_TIMEOUT,
          orElse: () => removePending(roomId, selfId).pipe(Effect.flatMap(() => new JoinDenied())),
        }),
      );

      return Stream.fromArray<RoomEvent>([new JoinPendingEvent({})]).pipe(
        Stream.concat(
          Stream.unwrap(
            admitted.pipe(Effect.map((result) => admittedStream(roomId, selfId, result))),
          ),
        ),
      );
    });

    const join = Effect.fn('@tether/RoomService.join')(function* (
      roomId: RoomId,
      selfId: PeerId,
      displayName: DisplayName,
    ) {
      return yield* Effect.acquireRelease(openJoin(roomId, selfId, displayName), () =>
        removeMember(roomId, selfId),
      );
    });

    const respondToJoin = Effect.fn('@tether/RoomService.respondToJoin')(function* (
      roomId: RoomId,
      selfId: PeerId,
      sessionToken: string,
      peerId: PeerId,
      decision: 'allow' | 'deny',
    ) {
      const action = yield* SynchronizedRef.modifyEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const newRegistry = new Map(registry);
          const ctx = newRegistry.get(roomId);
          const member = ctx?.members.find(
            (member) => member.peerId === selfId && member.sessionToken === sessionToken,
          );

          if (ctx === undefined || member === undefined) {
            return [{ _tag: 'not-member' } as RespondAction, newRegistry];
          }

          const pendingEntry = ctx.pending.find((entry) => entry.peerId === peerId);
          if (pendingEntry === undefined) {
            return [{ _tag: 'no-pending' } as RespondAction, newRegistry];
          }

          ctx.pending = ctx.pending.filter((entry) => entry.peerId !== peerId);

          // Deny outright, or if the room filled while the knock was pending.
          if (decision === 'deny' || ctx.members.length > 1) {
            return [
              { _tag: 'deny', deferred: pendingEntry.deferred } as RespondAction,
              newRegistry,
            ];
          }

          const newToken = yield* randomSessionToken;
          const signalBucket = yield* makeTokenBucket({
            capacity: SIGNAL_BUCKET_CAPACITY,
            refillEvery: SIGNAL_BUCKET_REFILL_EVERY,
          });
          ctx.members = [...ctx.members, { peerId, sessionToken: newToken, signalBucket }];

          yield* PubSub.publish(ctx.pubsub, new PeerJoinedEvent({ peerId }));
          yield* Effect.logInfo('Room session opened').pipe(
            Effect.annotateLogs('occupancy', ctx.members.length),
          );

          return [
            {
              _tag: 'allow',
              deferred: pendingEntry.deferred,
              result: {
                sessionToken: newToken,
                hostPeerId: selfId,
                subscription: pendingEntry.subscription,
              },
            } as RespondAction,
            newRegistry,
          ];
        }),
      );

      if (action._tag === 'not-member') {
        return yield* new PeerNotInRoom({ roomId, peerId: selfId });
      }
      if (action._tag === 'no-pending') {
        return yield* new NoPendingJoin({ roomId, peerId });
      }
      if (action._tag === 'deny') {
        yield* Deferred.fail(action.deferred, new JoinDenied());
        return;
      }
      yield* Deferred.succeed(action.deferred, action.result);
    });

    const sendSignal = Effect.fnUntraced(function* (
      roomId: RoomId,
      selfId: PeerId,
      sessionToken: string,
      signal: Signal,
    ) {
      yield* SynchronizedRef.modifyEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const ctx = registry.get(roomId);
          const member = ctx?.members.find(
            (member) => member.peerId === selfId && member.sessionToken === sessionToken,
          );

          if (ctx === undefined || member === undefined) {
            yield* Effect.logWarning('Signal rejected because peer is not in room');
            return yield* new PeerNotInRoom({ roomId, peerId: selfId });
          }

          const allowed = yield* member.signalBucket.tryTake;
          if (!allowed) {
            yield* Effect.logWarning('Signal dropped by rate limit');
            return [undefined, registry];
          }

          yield* PubSub.publish(ctx.pubsub, new SignalReceivedEvent({ peerId: selfId, signal }));

          return [undefined, registry];
        }),
      );
    });

    const leave = Effect.fn('@tether/RoomService.leave')(function* (
      roomId: RoomId,
      selfId: PeerId,
      sessionToken: string,
    ) {
      yield* removeMember(roomId, selfId, sessionToken);
    });

    return { host, join, respondToJoin, sendSignal, leave };
  }),
}) {
  // Leaves Crypto.Crypto as an open requirement; the composition root and tests
  // provide the platform implementation (see lib/ServerCrypto).
  static readonly layer = Layer.effect(this, this.make);
}

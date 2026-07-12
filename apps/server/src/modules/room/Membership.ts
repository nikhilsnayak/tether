import {
  JoinCancelledEvent,
  JoinDenied,
  PeerLeftEvent,
  RoomId,
  RoomSessionOpenedEvent,
  ServerAtCapacity,
  SessionToken,
  type PeerId,
  type RoomEvent,
} from '@tether/contracts/modules/room';
import { Context, Crypto, Deferred, Effect, Layer, Queue, Stream } from 'effect';

import { makeTokenBucket } from '@/lib/TokenBucket';

import { sendToMembers } from './Broadcast';
import {
  MAX_LIVE_ROOMS,
  ROOM_CREATE_BUCKET_CAPACITY,
  ROOM_CREATE_BUCKET_REFILL_EVERY,
  ROOM_ID_MINT_ATTEMPTS,
  SIGNAL_BUCKET_CAPACITY,
  SIGNAL_BUCKET_REFILL_EVERY,
} from './Constants';
import type { BroadcastRoomEvent, CreateOutcome, PendingJoin } from './Model';
import { RoomRegistry } from './Registry';

export class RoomMembership extends Context.Service<RoomMembership>()(
  '@tether/server/room/Membership',
  {
    make: Effect.gen(function* () {
      const registry = yield* RoomRegistry;
      const crypto = yield* Crypto.Crypto;
      const randomSessionToken = crypto.randomUUIDv4.pipe(Effect.orDie);
      const roomCreateBucket = yield* makeTokenBucket({
        capacity: ROOM_CREATE_BUCKET_CAPACITY,
        refillEvery: ROOM_CREATE_BUCKET_REFILL_EVERY,
      });
      const makeSignalBucket = makeTokenBucket({
        capacity: SIGNAL_BUCKET_CAPACITY,
        refillEvery: SIGNAL_BUCKET_REFILL_EVERY,
      });
      const alphabet = 'abcdefghijklmnopqrstuvwxyz';
      const randomCode = Effect.fnUntraced(function* (length: number) {
        const bytes = yield* crypto.randomBytes(length);
        return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
      });
      const generateRoomId = Effect.fnUntraced(function* () {
        return `${yield* randomCode(3)}-${yield* randomCode(4)}-${yield* randomCode(3)}`;
      });

      const removeMember = Effect.fnUntraced(function* (
        roomId: RoomId,
        selfId: PeerId,
        sessionToken?: string,
      ) {
        const denied = yield* registry.modify(
          Effect.fnUntraced(function* (state) {
            const context = state.get(roomId);

            if (context === undefined) return [] as PendingJoin[];
            if (context.pending.some((entry) => entry.peerId === selfId)) {
              context.pending = context.pending.filter((entry) => entry.peerId !== selfId);
              yield* sendToMembers(context, new JoinCancelledEvent({ peerId: selfId }));
              return [] as PendingJoin[];
            }

            const member = context.members.find((entry) => entry.peerId === selfId);
            if (member === undefined) return [] as PendingJoin[];
            if (sessionToken !== undefined && member.sessionToken !== sessionToken) {
              yield* Effect.logWarning('Leave rejected').pipe(
                Effect.annotateLogs('reason', 'invalid-session-token'),
              );
              return [] as PendingJoin[];
            }

            context.members = context.members.filter((entry) => entry.peerId !== selfId);
            yield* sendToMembers(context, new PeerLeftEvent({ peerId: selfId }));
            yield* Effect.logInfo('Room session closed').pipe(
              Effect.annotateLogs('occupancy', context.members.length),
            );

            if (context.members.length === 0) {
              state.delete(roomId);
              const toDeny = context.pending;
              context.pending = [];
              return toDeny;
            }
            return [] as PendingJoin[];
          }),
        );

        // Complete deferreds outside the registry critical section.
        yield* Effect.forEach(
          denied,
          (entry: PendingJoin) => Deferred.fail(entry.deferred, new JoinDenied()),
          { discard: true },
        );
      });

      const tryCreateRoom = Effect.fnUntraced(function* (roomId: RoomId, selfId: PeerId) {
        return yield* registry.modify((state) => {
          if (state.has(roomId)) return Effect.succeed({ _tag: 'collision' } as CreateOutcome);
          if (state.size >= MAX_LIVE_ROOMS)
            return Effect.logWarning('Room join rejected').pipe(
              Effect.annotateLogs('reason', 'server-at-capacity'),
              Effect.as({ _tag: 'rejected' } as CreateOutcome),
            );

          return roomCreateBucket.tryTake.pipe(
            Effect.flatMap((allowed) => {
              if (!allowed)
                return Effect.logWarning('Room join rejected').pipe(
                  Effect.annotateLogs('reason', 'room-creation-rate-limited'),
                  Effect.as({ _tag: 'rejected' } as CreateOutcome),
                );
              return Effect.all({
                events: Queue.unbounded<BroadcastRoomEvent>(),
                signalBucket: makeSignalBucket,
                sessionToken: randomSessionToken,
              }).pipe(
                Effect.flatMap(({ events, signalBucket, sessionToken }) => {
                  const brandedSessionToken = SessionToken.make(sessionToken);
                  state.set(roomId, {
                    members: [
                      { peerId: selfId, sessionToken: brandedSessionToken, signalBucket, events },
                    ],
                    pending: [],
                  });
                  const eventStream = Stream.fromArray<RoomEvent>([
                    new RoomSessionOpenedEvent({
                      peerId: null,
                      sessionToken: brandedSessionToken,
                      roomId,
                    }),
                  ]).pipe(Stream.concat(Stream.fromQueue(events)));
                  return Effect.logInfo('Room session opened').pipe(
                    Effect.annotateLogs('occupancy', 1),
                    Effect.as({ _tag: 'created', events: eventStream } as CreateOutcome),
                  );
                }),
              );
            }),
          );
        });
      });

      const openHost = Effect.fnUntraced(function* (selfId: PeerId) {
        for (let attempt = 0; attempt < ROOM_ID_MINT_ATTEMPTS; attempt++) {
          const roomId = RoomId.make(yield* generateRoomId().pipe(Effect.orDie));
          const result = yield* tryCreateRoom(roomId, selfId);
          if (result._tag === 'created') return { roomId, events: result.events };
          if (result._tag === 'rejected') return yield* new ServerAtCapacity();
        }
        return yield* new ServerAtCapacity();
      });

      return { openHost, removeMember };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

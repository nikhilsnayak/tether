import {
  JoinCancelledEvent,
  JoinDenied,
  JoinPendingEvent,
  JoinRequestedEvent,
  NoPendingJoin,
  PeerAlreadyJoined,
  PeerNotInRoom,
  PeerJoinedEvent,
  RoomFull,
  RoomNotFound,
  RoomSessionOpenedEvent,
  SessionToken,
  type DisplayName,
  type PeerId,
  type RoomEvent,
  type RoomId,
} from '@tether/contracts/modules/room';
import { Context, Crypto, Deferred, Effect, Layer, Queue, Stream } from 'effect';

import { makeTokenBucket } from '@/lib/TokenBucket';

import { sendToMembers } from './Broadcast';
import {
  JOIN_REQUEST_TIMEOUT,
  SIGNAL_BUCKET_CAPACITY,
  SIGNAL_BUCKET_REFILL_EVERY,
} from './Constants';
import type { AdmitResult, BroadcastRoomEvent, JoinOutcome, RespondAction } from './Model';
import { RoomRegistry } from './Registry';

export class RoomAdmission extends Context.Service<RoomAdmission>()(
  '@tether/server/room/Admission',
  {
    make: Effect.gen(function* () {
      const registry = yield* RoomRegistry;
      const crypto = yield* Crypto.Crypto;
      const randomSessionToken = crypto.randomUUIDv4.pipe(Effect.orDie);
      const makeSignalBucket = makeTokenBucket({
        capacity: SIGNAL_BUCKET_CAPACITY,
        refillEvery: SIGNAL_BUCKET_REFILL_EVERY,
      });

      const removePending = Effect.fnUntraced(function* (roomId: RoomId, peerId: PeerId) {
        yield* registry.modify(
          Effect.fnUntraced(function* (registry) {
            const context = registry.get(roomId);
            if (context !== undefined && context.pending.some((entry) => entry.peerId === peerId)) {
              context.pending = context.pending.filter((entry) => entry.peerId !== peerId);
              yield* sendToMembers(context, new JoinCancelledEvent({ peerId }));
            }
            return undefined;
          }),
        );
      });

      const admittedStream = (roomId: RoomId, result: AdmitResult) =>
        Stream.fromArray<RoomEvent>([
          new RoomSessionOpenedEvent({
            peerId: result.hostPeerId,
            sessionToken: result.sessionToken,
            roomId,
            roomTemplateId: result.roomTemplateId,
          }),
        ]).pipe(Stream.concat(Stream.fromQueue(result.events)));

      const openJoin = Effect.fnUntraced(function* (
        roomId: RoomId,
        selfId: PeerId,
        displayName: DisplayName,
      ) {
        const deferred = yield* Deferred.make<AdmitResult, JoinDenied>();
        const events = yield* Queue.unbounded<BroadcastRoomEvent>();

        const outcome = yield* registry.modify(
          Effect.fnUntraced(function* (registry) {
            const context = registry.get(roomId);

            if (context === undefined || context.members.length === 0) {
              return { _tag: 'not-found' } as JoinOutcome;
            }
            if (
              context.members.some((member) => member.peerId === selfId) ||
              context.pending.some((entry) => entry.peerId === selfId)
            ) {
              yield* Effect.logWarning('Room join rejected').pipe(
                Effect.annotateLogs('reason', 'peer-already-joined'),
              );
              return { _tag: 'already-joined' } as JoinOutcome;
            }
            if (context.members.length > 1) {
              yield* Effect.logWarning('Room join rejected').pipe(
                Effect.annotateLogs('reason', 'room-full'),
              );
              return { _tag: 'full' } as JoinOutcome;
            }

            context.pending = [
              ...context.pending,
              { peerId: selfId, displayName, deferred, events },
            ];
            yield* sendToMembers(context, new JoinRequestedEvent({ peerId: selfId, displayName }));
            yield* Effect.logInfo('Join requested');
            return { _tag: 'pending' } as JoinOutcome;
          }),
        );

        if (outcome._tag === 'not-found') return yield* new RoomNotFound({ roomId });
        if (outcome._tag === 'already-joined') {
          return yield* new PeerAlreadyJoined({ roomId, peerId: selfId });
        }
        if (outcome._tag === 'full') return yield* new RoomFull({ roomId });

        const admitted = Deferred.await(deferred).pipe(
          Effect.timeoutOrElse({
            duration: JOIN_REQUEST_TIMEOUT,
            orElse: () =>
              removePending(roomId, selfId).pipe(Effect.flatMap(() => new JoinDenied())),
          }),
        );

        return Stream.fromArray<RoomEvent>([new JoinPendingEvent({})]).pipe(
          Stream.concat(
            Stream.unwrap(admitted.pipe(Effect.map((result) => admittedStream(roomId, result)))),
          ),
        );
      });

      const respondToJoin = Effect.fnUntraced(function* (
        roomId: RoomId,
        selfId: PeerId,
        sessionToken: string,
        peerId: PeerId,
        decision: 'allow' | 'deny',
      ) {
        const action = yield* registry.modify(
          Effect.fnUntraced(function* (registry) {
            const context = registry.get(roomId);
            const member = context?.members.find(
              (entry) => entry.peerId === selfId && entry.sessionToken === sessionToken,
            );
            if (context === undefined || member === undefined) {
              return { _tag: 'not-member' } as RespondAction;
            }

            const pendingEntry = context.pending.find((entry) => entry.peerId === peerId);
            if (pendingEntry === undefined) {
              return { _tag: 'no-pending' } as RespondAction;
            }
            context.pending = context.pending.filter((entry) => entry.peerId !== peerId);

            if (decision === 'deny' || context.members.length > 1) {
              return { _tag: 'deny', deferred: pendingEntry.deferred } as RespondAction;
            }

            const newToken = SessionToken.make(yield* randomSessionToken);
            const signalBucket = yield* makeSignalBucket;
            context.members = [
              ...context.members,
              { peerId, sessionToken: newToken, signalBucket, events: pendingEntry.events },
            ];
            yield* sendToMembers(context, new PeerJoinedEvent({ peerId }), peerId);
            yield* Effect.logInfo('Room session opened').pipe(
              Effect.annotateLogs('occupancy', context.members.length),
            );

            return {
              _tag: 'allow',
              deferred: pendingEntry.deferred,
              result: {
                sessionToken: newToken,
                hostPeerId: selfId,
                events: pendingEntry.events,
                roomTemplateId: context.roomTemplateId,
              },
            } as RespondAction;
          }),
        );

        if (action._tag === 'not-member') {
          return yield* new PeerNotInRoom({ roomId, peerId: selfId });
        }
        if (action._tag === 'no-pending') return yield* new NoPendingJoin({ roomId, peerId });
        if (action._tag === 'deny') return yield* Deferred.fail(action.deferred, new JoinDenied());
        yield* Deferred.succeed(action.deferred, action.result);
      });

      return { openJoin, removePending, respondToJoin };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

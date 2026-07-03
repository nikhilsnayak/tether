import {
  PeerAlreadyJoined,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomSessionOpenedEvent,
  RoomFull,
  SignalReceivedEvent,
  type PeerId,
  type RoomEvent,
  type RoomId,
  type Signal,
} from '@tether/contracts/modules/room';
import { Context, Effect, Layer, PubSub, Stream, SynchronizedRef } from 'effect';

import { makeTokenBucket, type TokenBucket } from '../../lib/TokenBucket';
import { MAX_LIVE_ROOMS, SIGNAL_BUCKET_CAPACITY, SIGNAL_BUCKET_REFILL_EVERY } from './Constants';

type Member = {
  readonly peerId: PeerId;
  readonly sessionToken: string;
  readonly signalBucket: TokenBucket;
};
type Registry = Map<RoomId, { members: Member[]; pubsub: PubSub.PubSub<RoomEvent> }>;

export class RoomService extends Context.Service<RoomService>()('@tether/RoomService', {
  make: Effect.gen(function* () {
    const registryRef = yield* SynchronizedRef.make<Registry>(new Map());

    const removeMember = Effect.fnUntraced(function* (
      roomId: RoomId,
      selfId: PeerId,
      sessionToken?: string,
    ) {
      yield* SynchronizedRef.modifyEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const newRegistry = new Map(registry);
          const ctx = newRegistry.get(roomId);

          if (ctx === undefined) {
            return [undefined, newRegistry];
          }

          const member = ctx.members.find((member) => member.peerId === selfId);

          if (member === undefined) {
            return [undefined, newRegistry];
          }

          if (sessionToken !== undefined && member.sessionToken !== sessionToken) {
            yield* Effect.logWarning('Leave rejected').pipe(
              Effect.annotateLogs('reason', 'invalid-session-token'),
            );
            return [undefined, newRegistry];
          }

          ctx.members = ctx.members.filter((member) => member.peerId !== selfId);

          yield* PubSub.publish(ctx.pubsub, new PeerLeftEvent({ peerId: selfId }));
          yield* Effect.logInfo('Room session closed').pipe(
            Effect.annotateLogs('occupancy', ctx.members.length),
          );

          if (ctx.members.length === 0) {
            newRegistry.delete(roomId);
          }

          return [undefined, newRegistry];
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

    const openSession = Effect.fn('@tether/RoomService.openSession')(function* (
      roomId: RoomId,
      selfId: PeerId,
    ) {
      return yield* Effect.acquireRelease(
        SynchronizedRef.modifyEffect(
          registryRef,
          Effect.fnUntraced(function* (registry) {
            const sessionToken = crypto.randomUUID();
            const newRegistry = new Map(registry);
            let ctx = newRegistry.get(roomId);

            if (ctx === undefined) {
              if (newRegistry.size >= MAX_LIVE_ROOMS) {
                yield* Effect.logWarning('Room join rejected').pipe(
                  Effect.annotateLogs('reason', 'server-at-capacity'),
                );
                return yield* new RoomFull({ roomId });
              }

              const pubsub = yield* PubSub.unbounded<RoomEvent>();

              ctx = { members: [], pubsub };

              newRegistry.set(roomId, ctx);
            }

            if (ctx.members.some((member) => member.peerId === selfId)) {
              yield* Effect.logWarning('Room join rejected').pipe(
                Effect.annotateLogs('reason', 'peer-already-joined'),
              );
              return yield* new PeerAlreadyJoined({ roomId, peerId: selfId });
            }

            if (ctx.members.length > 1) {
              yield* Effect.logWarning('Room join rejected').pipe(
                Effect.annotateLogs('reason', 'room-full'),
              );
              return yield* new RoomFull({ roomId });
            }

            const subscription = yield* PubSub.subscribe(ctx.pubsub);
            const signalBucket = yield* makeTokenBucket({
              capacity: SIGNAL_BUCKET_CAPACITY,
              refillEvery: SIGNAL_BUCKET_REFILL_EVERY,
            });

            ctx.members = [...ctx.members, { peerId: selfId, sessionToken, signalBucket }];

            yield* PubSub.publish(ctx.pubsub, new PeerJoinedEvent({ peerId: selfId }));
            yield* Effect.logInfo('Room session opened').pipe(
              Effect.annotateLogs('occupancy', ctx.members.length),
            );

            const peerId = ctx.members.find((member) => member.peerId !== selfId)?.peerId ?? null;
            const initial = [new RoomSessionOpenedEvent({ peerId, sessionToken })];

            const events = Stream.fromArray<RoomEvent>(initial).pipe(
              Stream.concat(Stream.fromSubscription(subscription)),
              Stream.filter((event) => event.peerId !== selfId),
            );

            return [events, newRegistry];
          }),
        ),
        () => removeMember(roomId, selfId),
      );
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

    return { openSession, sendSignal, leave };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);

  static readonly layerTest = Layer.effect(this, this.make);
}

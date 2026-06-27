import {
  PeerAlreadyJoined,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomFull,
  SignalReceivedEvent,
  type PeerId,
  type RoomEvent,
  type RoomId,
  type Signal,
} from '@tether/contracts/modules/room';
import { Context, Effect, Layer, PubSub, Stream, SynchronizedRef } from 'effect';

type Registry = Map<RoomId, { members: PeerId[]; pubsub: PubSub.PubSub<RoomEvent> }>;

export class RoomService extends Context.Service<RoomService>()('@tether/RoomService', {
  make: Effect.gen(function* () {
    const registryRef = yield* SynchronizedRef.make<Registry>(new Map());

    const leave = Effect.fn('@tether/RoomService.leave')(function* (
      roomId: RoomId,
      selfId: PeerId,
    ) {
      yield* SynchronizedRef.modifyEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const newRegistry = new Map(registry);
          const ctx = newRegistry.get(roomId);

          if (ctx === undefined) {
            return [undefined, newRegistry];
          }

          ctx.members = ctx.members.filter((member) => member !== selfId);

          yield* PubSub.publish(ctx.pubsub, new PeerLeftEvent({ peerId: selfId }));

          if (ctx.members.length === 0) {
            newRegistry.delete(roomId);
          }

          return [undefined, newRegistry];
        }),
      );
    });

    const join = Effect.fn('@tether/RoomService.join')(function* (roomId: RoomId, selfId: PeerId) {
      return yield* Effect.acquireRelease(
        SynchronizedRef.modifyEffect(
          registryRef,
          Effect.fnUntraced(function* (registry) {
            const newRegistry = new Map(registry);
            let ctx = newRegistry.get(roomId);

            if (ctx === undefined) {
              const pubsub = yield* PubSub.unbounded<RoomEvent>();

              ctx = { members: [], pubsub };

              newRegistry.set(roomId, ctx);
            }

            if (ctx.members.includes(selfId)) {
              return yield* new PeerAlreadyJoined({ roomId, peerId: selfId });
            }

            if (ctx.members.length > 1) {
              return yield* new RoomFull({ roomId });
            }

            const subscription = yield* PubSub.subscribe(ctx.pubsub);

            ctx.members = [...ctx.members, selfId];

            yield* PubSub.publish(ctx.pubsub, new PeerJoinedEvent({ peerId: selfId }));

            const peerId = ctx.members.find((member) => member !== selfId) ?? null;
            const initial = peerId === null ? [] : [new PeerJoinedEvent({ peerId })];

            const events = Stream.fromArray<RoomEvent>(initial).pipe(
              Stream.concat(Stream.fromSubscription(subscription)),
              Stream.filter((event) => event.peerId !== selfId),
            );

            return [events, newRegistry];
          }),
        ),
        () => leave(roomId, selfId),
      );
    });

    const sendSignal = Effect.fn('@tether/RoomService.sendSignal')(function* (
      roomId: RoomId,
      selfId: PeerId,
      signal: Signal,
    ) {
      yield* SynchronizedRef.modifyEffect(
        registryRef,
        Effect.fnUntraced(function* (registry) {
          const ctx = registry.get(roomId);

          if (ctx === undefined || !ctx.members.includes(selfId)) {
            return yield* new PeerNotInRoom({ roomId, peerId: selfId });
          }

          yield* PubSub.publish(ctx.pubsub, new SignalReceivedEvent({ peerId: selfId, signal }));

          return [undefined, registry];
        }),
      );
    });

    return { join, sendSignal };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);

  static readonly layerTest = Layer.effect(this, this.make);
}

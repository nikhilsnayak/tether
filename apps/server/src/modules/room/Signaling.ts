import {
  DetachedEvent,
  PeerNotInRoom,
  SignalReceivedEvent,
  type PeerId,
  type RoomId,
  type Signal,
} from '@tether/contracts/modules/room';
import { Context, Effect, Layer } from 'effect';

import { sendToMembers } from './Broadcast';
import { RoomRegistry } from './Registry';

export class RoomSignaling extends Context.Service<RoomSignaling>()(
  '@tether/server/room/Signaling',
  {
    make: Effect.gen(function* () {
      const registry = yield* RoomRegistry;

      const sendSignal = Effect.fnUntraced(function* (
        roomId: RoomId,
        selfId: PeerId,
        sessionToken: string,
        signal: Signal,
      ) {
        yield* registry.modify(
          Effect.fnUntraced(function* (state) {
            const context = state.get(roomId);
            const member = context?.members.find(
              (entry) => entry.peerId === selfId && entry.sessionToken === sessionToken,
            );
            if (context === undefined || member === undefined) {
              yield* Effect.logWarning('Signal rejected because peer is not in room');
              return yield* new PeerNotInRoom({ roomId, peerId: selfId });
            }

            if (!(yield* member.signalBucket.tryTake)) {
              yield* Effect.logWarning('Signal dropped by rate limit');
              return undefined;
            }

            if (
              signal._tag === '@tether/SessionDescriptionSignal' &&
              signal.type === 'offer' &&
              (context.latestOfferEpoch === null ||
                signal.negotiationEpoch > context.latestOfferEpoch)
            ) {
              context.latestOfferEpoch = signal.negotiationEpoch;
              context.members = context.members.map((entry) => ({
                ...entry,
                detachReadyEpoch: null,
              }));
            }

            yield* sendToMembers(
              context,
              new SignalReceivedEvent({ peerId: selfId, signal }),
              selfId,
            );
            return undefined;
          }),
        );
      });

      const readyToDetach = Effect.fnUntraced(function* (
        roomId: RoomId,
        selfId: PeerId,
        sessionToken: string,
        negotiationEpoch: number,
      ) {
        yield* registry.modify(
          Effect.fnUntraced(function* (state) {
            const context = state.get(roomId);
            const member = context?.members.find(
              (entry) => entry.peerId === selfId && entry.sessionToken === sessionToken,
            );
            if (context === undefined || member === undefined) {
              yield* Effect.logWarning('Detach readiness rejected because peer is not in room');
              return yield* new PeerNotInRoom({ roomId, peerId: selfId });
            }
            if (context.detached) return undefined;
            if (
              context.latestOfferEpoch === null ||
              negotiationEpoch !== context.latestOfferEpoch
            ) {
              yield* Effect.logWarning('Ignored stale detach readiness').pipe(
                Effect.annotateLogs({
                  latestOfferEpoch: context.latestOfferEpoch,
                  receivedEpoch: negotiationEpoch,
                }),
              );
              return undefined;
            }

            context.members = context.members.map((entry) =>
              entry.peerId === selfId ? { ...entry, detachReadyEpoch: negotiationEpoch } : entry,
            );

            const committed =
              context.members.length === 2 &&
              context.members.every((entry) => entry.detachReadyEpoch === context.latestOfferEpoch);
            if (committed) {
              context.detached = true;
              yield* sendToMembers(context, new DetachedEvent({}));
              yield* Effect.logInfo('Room detached');
            }
            return undefined;
          }),
        );
      });

      return { readyToDetach, sendSignal };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

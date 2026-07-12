import {
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

            yield* sendToMembers(
              context,
              new SignalReceivedEvent({ peerId: selfId, signal }),
              selfId,
            );
            return undefined;
          }),
        );
      });

      return { sendSignal };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

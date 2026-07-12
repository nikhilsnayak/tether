import type { PeerId, RoomEvent } from '@tether/contracts/modules/room';
import { Effect, Queue } from 'effect';

import type { RoomContext } from './Model';

export const sendToMembers = Effect.fnUntraced(function* (
  context: RoomContext,
  event: Exclude<RoomEvent, { readonly _tag: '@tether/JoinPendingEvent' }>,
  exceptPeerId?: PeerId,
) {
  yield* Effect.forEach(
    context.members,
    (member) => (member.peerId === exceptPeerId ? Effect.void : Queue.offer(member.events, event)),
    { discard: true },
  );
});

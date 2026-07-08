import { RoomRpcs } from '@tether/contracts/modules/room';
import { Effect, Stream } from 'effect';

import { RoomService } from './RoomService';

export const RoomHandlers = RoomRpcs.toLayer(
  Effect.gen(function* () {
    const room = yield* RoomService;

    return RoomRpcs.of({
      OpenRoomSession: Effect.fnUntraced(function* (payload) {
        const events = yield* payload.intent === 'host'
          ? room.host(payload.selfId)
          : room.join(payload.roomId, payload.selfId, payload.displayName);

        return events.pipe(Stream.map((event) => ({ event })));
      }, Stream.unwrap),
      RespondToJoin: Effect.fnUntraced(function* ({
        roomId,
        selfId,
        sessionToken,
        peerId,
        decision,
      }) {
        yield* room.respondToJoin(roomId, selfId, sessionToken, peerId, decision);
      }),
      SendSignal: Effect.fnUntraced(function* ({ roomId, selfId, sessionToken, signal }) {
        yield* room.sendSignal(roomId, selfId, sessionToken, signal);
      }),
      LeaveRoom: Effect.fnUntraced(function* ({ roomId, selfId, sessionToken }) {
        yield* room.leave(roomId, selfId, sessionToken);
      }),
    });
  }),
);

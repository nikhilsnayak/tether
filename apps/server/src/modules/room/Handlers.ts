import { RoomRpcs } from '@tether/contracts/modules/room';
import { Effect, Stream } from 'effect';

import { RoomService } from './RoomService';

export const RoomHandlers = RoomRpcs.toLayer(
  Effect.gen(function* () {
    const room = yield* RoomService;

    return RoomRpcs.of({
      OpenRoomSession: Effect.fnUntraced(function* (payload) {
        const events = yield* payload.intent === 'host'
          ? room.host(payload.selfId, payload.roomTemplateId)
          : room.join(payload.roomId, payload.selfId, payload.displayName);

        return events.pipe(Stream.map((event) => ({ event })));
      }, Stream.unwrap),
      GetRoomMetadata: Effect.fnUntraced(function* ({ roomId }) {
        return yield* room.getRoomMetadata(roomId);
      }),
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
      ReadyToDetach: Effect.fnUntraced(function* ({
        roomId,
        selfId,
        sessionToken,
        negotiationEpoch,
      }) {
        yield* room.readyToDetach(roomId, selfId, sessionToken, negotiationEpoch);
      }),
      LeaveRoom: Effect.fnUntraced(function* ({ roomId, selfId, sessionToken }) {
        yield* room.leave(roomId, selfId, sessionToken);
      }),
    });
  }),
);

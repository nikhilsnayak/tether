import { RoomRpcs } from '@tether/contracts/modules/room';
import { Effect, Stream } from 'effect';

import { RoomService } from './RoomService';

export const RoomHandlers = RoomRpcs.toLayer(
  Effect.gen(function* () {
    const room = yield* RoomService;

    return RoomRpcs.of({
      OpenRoomSession: Effect.fnUntraced(function* ({ roomId, selfId }) {
        const events = yield* room.openSession(roomId, selfId);

        return events.pipe(Stream.map((event) => ({ event })));
      }, Stream.unwrap),
      SendSignal: Effect.fnUntraced(function* ({ roomId, selfId, signal }) {
        yield* room.sendSignal(roomId, selfId, signal);
      }),
    });
  }),
);

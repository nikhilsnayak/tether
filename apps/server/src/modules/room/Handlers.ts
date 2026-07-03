import { RoomRpcs } from '@tether/contracts/modules/room';
import { Config, Effect, Stream } from 'effect';

import { RoomService } from './RoomService';

export const RoomHandlers = RoomRpcs.toLayer(
  Effect.gen(function* () {
    const room = yield* RoomService;
    const stunUrls = yield* Config.string('STUN_URLS').pipe(
      Config.withDefault('stun:stun.l.google.com:19302'),
    );
    const turnUrl = yield* Config.string('TURN_URL').pipe(Config.withDefault(''));
    const turnUsername = yield* Config.string('TURN_USERNAME').pipe(Config.withDefault(''));
    const turnCredential = yield* Config.string('TURN_CREDENTIAL').pipe(Config.withDefault(''));

    const iceServers = [
      { urls: stunUrls.split(',').map((url) => url.trim()) },
      ...(turnUrl !== ''
        ? [{ urls: [turnUrl], username: turnUsername, credential: turnCredential }]
        : []),
    ];

    return RoomRpcs.of({
      GetIceServers: () => Effect.succeed({ iceServers }),
      OpenRoomSession: Effect.fnUntraced(function* ({ roomId, selfId }) {
        const events = yield* room.openSession(roomId, selfId);

        return events.pipe(Stream.map((event) => ({ event })));
      }, Stream.unwrap),
      LeaveRoom: Effect.fnUntraced(function* ({ roomId, selfId }) {
        yield* room.leave(roomId, selfId);
      }),
      SendSignal: Effect.fnUntraced(function* ({ roomId, selfId, signal }) {
        yield* room.sendSignal(roomId, selfId, signal);
      }),
    });
  }),
);

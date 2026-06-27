import { Schema } from 'effect';

export const PeerId = Schema.String.pipe(Schema.brand('PeerId'));
export type PeerId = typeof PeerId.Type;

export const RoomId = Schema.String.pipe(Schema.brand('RoomId'));
export type RoomId = typeof RoomId.Type;

export const Signal = Schema.Struct({
  type: Schema.Literals(['offer', 'answer']),
  sdp: Schema.String,
});
export type Signal = typeof Signal.Type;

export class PeerJoinedEvent extends Schema.TaggedClass<PeerJoinedEvent>()(
  '@tether/PeerJoinedEvent',
  {
    peerId: PeerId,
  },
) {}

export class PeerLeftEvent extends Schema.TaggedClass<PeerLeftEvent>()('@tether/PeerLeftEvent', {
  peerId: PeerId,
}) {}

export class SignalReceivedEvent extends Schema.TaggedClass<SignalReceivedEvent>()(
  '@tether/SignalReceivedEvent',
  {
    peerId: PeerId,
    signal: Signal,
  },
) {}

export class RoomFull extends Schema.TaggedErrorClass<RoomFull>()('@tether/RoomFull', {
  roomId: RoomId,
}) {}

export class PeerAlreadyJoined extends Schema.TaggedErrorClass<PeerAlreadyJoined>()(
  '@tether/PeerAlreadyJoined',
  {
    roomId: RoomId,
    peerId: PeerId,
  },
) {}

export class PeerNotInRoom extends Schema.TaggedErrorClass<PeerNotInRoom>()(
  '@tether/PeerNotInRoom',
  {
    roomId: RoomId,
    peerId: PeerId,
  },
) {}

export const RoomEvent = Schema.Union([PeerJoinedEvent, PeerLeftEvent, SignalReceivedEvent]);
export type RoomEvent = typeof RoomEvent.Type;

export const JoinRoomPayload = Schema.Struct({
  selfId: PeerId,
  roomId: RoomId,
});

export const JoinRoomSuccess = Schema.Struct({
  event: RoomEvent,
});

export const JoinRoomError = Schema.Union([RoomFull, PeerAlreadyJoined]);

export const SendSignalPayload = Schema.Struct({
  selfId: PeerId,
  roomId: RoomId,
  signal: Signal,
});

export const SendSignalError = Schema.Union([PeerNotInRoom]);

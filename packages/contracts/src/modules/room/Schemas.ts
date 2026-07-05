import { Schema } from 'effect';

export const PeerId = Schema.String.pipe(Schema.brand('PeerId'));
export type PeerId = typeof PeerId.Type;

export const RoomId = Schema.String.pipe(Schema.brand('RoomId'));
export type RoomId = typeof RoomId.Type;

export class SessionDescriptionSignal extends Schema.TaggedClass<SessionDescriptionSignal>()(
  '@tether/SessionDescriptionSignal',
  {
    type: Schema.Literals(['offer', 'answer']),
    sdp: Schema.String,
  },
) {}

export class IceCandidateSignal extends Schema.TaggedClass<IceCandidateSignal>()(
  '@tether/IceCandidateSignal',
  {
    candidate: Schema.String,
    sdpMid: Schema.NullOr(Schema.String),
    sdpMLineIndex: Schema.NullOr(Schema.Number),
    usernameFragment: Schema.NullOr(Schema.String),
  },
) {}

export const Signal = Schema.Union([SessionDescriptionSignal, IceCandidateSignal]);
export type Signal = typeof Signal.Type;

export class RoomSessionOpenedEvent extends Schema.TaggedClass<RoomSessionOpenedEvent>()(
  '@tether/RoomSessionOpenedEvent',
  {
    peerId: Schema.NullOr(PeerId),
    sessionToken: Schema.String,
  },
) {}

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

export const isRoomFull = Schema.is(RoomFull);

export class PeerAlreadyJoined extends Schema.TaggedErrorClass<PeerAlreadyJoined>()(
  '@tether/PeerAlreadyJoined',
  {
    roomId: RoomId,
    peerId: PeerId,
  },
) {}

export const isPeerAlreadyJoined = Schema.is(PeerAlreadyJoined);

export class PeerNotInRoom extends Schema.TaggedErrorClass<PeerNotInRoom>()(
  '@tether/PeerNotInRoom',
  {
    roomId: RoomId,
    peerId: PeerId,
  },
) {}

export const isPeerNotInRoom = Schema.is(PeerNotInRoom);

export const RoomEvent = Schema.Union([
  RoomSessionOpenedEvent,
  PeerJoinedEvent,
  PeerLeftEvent,
  SignalReceivedEvent,
]);
export type RoomEvent = typeof RoomEvent.Type;

export const OpenRoomSessionPayload = Schema.Struct({
  selfId: PeerId,
  roomId: RoomId,
});

export const OpenRoomSessionSuccess = Schema.Struct({
  event: RoomEvent,
});

export const OpenRoomSessionError = Schema.Union([RoomFull, PeerAlreadyJoined]);

export const LeaveRoomPayload = Schema.Struct({
  selfId: PeerId,
  roomId: RoomId,
  sessionToken: Schema.String,
});

export const SendSignalPayload = Schema.Struct({
  selfId: PeerId,
  roomId: RoomId,
  sessionToken: Schema.String,
  signal: Signal,
});

export const SendSignalError = Schema.Union([PeerNotInRoom]);

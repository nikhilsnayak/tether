import { Schema } from 'effect';

const PeerIdString = Schema.String.check(Schema.isPattern(/^[a-z]{12}$/));
const RoomIdString = Schema.String.check(Schema.isPattern(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/));
const SessionToken = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const SessionDescription = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(262_144));
const IceCandidate = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8_192));
const IceCandidateAttribute = Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(256));

export const PeerId = PeerIdString.pipe(Schema.brand('PeerId'));
export type PeerId = typeof PeerId.Type;

export const RoomId = RoomIdString.pipe(Schema.brand('RoomId'));
export type RoomId = typeof RoomId.Type;

export class SessionDescriptionSignal extends Schema.TaggedClass<SessionDescriptionSignal>()(
  '@tether/SessionDescriptionSignal',
  {
    type: Schema.Literals(['offer', 'answer']),
    sdp: SessionDescription,
  },
) {}

export class IceCandidateSignal extends Schema.TaggedClass<IceCandidateSignal>()(
  '@tether/IceCandidateSignal',
  {
    candidate: IceCandidate,
    sdpMid: Schema.NullOr(IceCandidateAttribute),
    sdpMLineIndex: Schema.NullOr(Schema.Number),
    usernameFragment: Schema.NullOr(IceCandidateAttribute),
  },
) {}

export const Signal = Schema.Union([SessionDescriptionSignal, IceCandidateSignal]);
export type Signal = typeof Signal.Type;

export class RoomSessionOpenedEvent extends Schema.TaggedClass<RoomSessionOpenedEvent>()(
  '@tether/RoomSessionOpenedEvent',
  {
    peerId: Schema.NullOr(PeerId),
    sessionToken: SessionToken,
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

export class ServerAtCapacity extends Schema.TaggedErrorClass<ServerAtCapacity>()(
  '@tether/ServerAtCapacity',
  {},
) {}

export const isServerAtCapacity = Schema.is(ServerAtCapacity);

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

export const OpenRoomSessionError = Schema.Union([RoomFull, ServerAtCapacity, PeerAlreadyJoined]);

export const LeaveRoomPayload = Schema.Struct({
  selfId: PeerId,
  roomId: RoomId,
  sessionToken: SessionToken,
});

export const SendSignalPayload = Schema.Struct({
  selfId: PeerId,
  roomId: RoomId,
  sessionToken: SessionToken,
  signal: Signal,
});

export const SendSignalError = Schema.Union([PeerNotInRoom]);

import { Schema } from 'effect';

const PeerIdString = Schema.String.check(Schema.isPattern(/^[a-z]{12}$/));
const RoomIdString = Schema.String.check(Schema.isPattern(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/));
const SessionToken = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const SessionDescription = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(262_144));
const IceCandidate = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8_192));
const IceCandidateAttribute = Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(256));
const NegotiationEpoch = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);

export const PeerId = PeerIdString.pipe(Schema.brand('PeerId'));
export type PeerId = typeof PeerId.Type;

export const RoomId = RoomIdString.pipe(Schema.brand('RoomId'));
export type RoomId = typeof RoomId.Type;

const DisplayNameString = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(32));
export const DisplayName = DisplayNameString.pipe(Schema.brand('DisplayName'));
export type DisplayName = typeof DisplayName.Type;

export class SessionDescriptionSignal extends Schema.TaggedClass<SessionDescriptionSignal>()(
  '@tether/SessionDescriptionSignal',
  {
    type: Schema.Literals(['offer', 'answer']),
    sdp: SessionDescription,
    negotiationEpoch: NegotiationEpoch,
  },
) {}

export class IceCandidateSignal extends Schema.TaggedClass<IceCandidateSignal>()(
  '@tether/IceCandidateSignal',
  {
    candidate: IceCandidate,
    sdpMid: Schema.NullOr(IceCandidateAttribute),
    sdpMLineIndex: Schema.NullOr(Schema.Number),
    usernameFragment: Schema.NullOr(IceCandidateAttribute),
    negotiationEpoch: NegotiationEpoch,
  },
) {}

export const Signal = Schema.Union([SessionDescriptionSignal, IceCandidateSignal]);
export type Signal = typeof Signal.Type;

export class RoomSessionOpenedEvent extends Schema.TaggedClass<RoomSessionOpenedEvent>()(
  '@tether/RoomSessionOpenedEvent',
  {
    peerId: Schema.NullOr(PeerId),
    sessionToken: SessionToken,
    roomId: RoomId,
  },
) {}

export class JoinRequestedEvent extends Schema.TaggedClass<JoinRequestedEvent>()(
  '@tether/JoinRequestedEvent',
  {
    peerId: PeerId,
    displayName: DisplayName,
  },
) {}

export class JoinPendingEvent extends Schema.TaggedClass<JoinPendingEvent>()(
  '@tether/JoinPendingEvent',
  {},
) {}

// Broadcast to the host when a pending knock is withdrawn before a decision
// (the joiner disconnected or the knock timed out), so the prompt can clear.
export class JoinCancelledEvent extends Schema.TaggedClass<JoinCancelledEvent>()(
  '@tether/JoinCancelledEvent',
  {
    peerId: PeerId,
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

export class RoomNotFound extends Schema.TaggedErrorClass<RoomNotFound>()('@tether/RoomNotFound', {
  roomId: RoomId,
}) {}

export const isRoomNotFound = Schema.is(RoomNotFound);

export class JoinDenied extends Schema.TaggedErrorClass<JoinDenied>()('@tether/JoinDenied', {}) {}

export const isJoinDenied = Schema.is(JoinDenied);

export class NoPendingJoin extends Schema.TaggedErrorClass<NoPendingJoin>()(
  '@tether/NoPendingJoin',
  {
    roomId: RoomId,
    peerId: PeerId,
  },
) {}

export const isNoPendingJoin = Schema.is(NoPendingJoin);

export const RoomEvent = Schema.Union([
  RoomSessionOpenedEvent,
  PeerJoinedEvent,
  PeerLeftEvent,
  SignalReceivedEvent,
  JoinRequestedEvent,
  JoinPendingEvent,
  JoinCancelledEvent,
]);
export type RoomEvent = typeof RoomEvent.Type;

// A host mints a fresh room; a joiner must name the room and itself. Modelling
// this as a discriminated union makes the requirement structural — the wire
// schema rejects a join with no roomId, so no runtime null-checks are needed.
export const OpenRoomSessionPayload = Schema.Union([
  Schema.Struct({
    intent: Schema.Literal('host'),
    selfId: PeerId,
  }),
  Schema.Struct({
    intent: Schema.Literal('join'),
    selfId: PeerId,
    roomId: RoomId,
    displayName: DisplayName,
  }),
]);
export type OpenRoomSessionPayload = typeof OpenRoomSessionPayload.Type;

export const OpenRoomSessionSuccess = Schema.Struct({
  event: RoomEvent,
});

export const OpenRoomSessionError = Schema.Union([
  RoomFull,
  ServerAtCapacity,
  PeerAlreadyJoined,
  RoomNotFound,
  JoinDenied,
]);

export const RespondToJoinPayload = Schema.Struct({
  roomId: RoomId,
  selfId: PeerId,
  sessionToken: SessionToken,
  peerId: PeerId,
  decision: Schema.Literals(['allow', 'deny']),
});

export const RespondToJoinError = Schema.Union([PeerNotInRoom, NoPendingJoin]);

export const SendSignalPayload = Schema.Struct({
  selfId: PeerId,
  roomId: RoomId,
  sessionToken: SessionToken,
  signal: Signal,
});

export const SendSignalError = Schema.Union([PeerNotInRoom]);

export const LeaveRoomPayload = Schema.Struct({
  selfId: PeerId,
  roomId: RoomId,
  sessionToken: SessionToken,
});

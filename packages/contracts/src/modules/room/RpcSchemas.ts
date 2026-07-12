import { Schema } from 'effect';

import {
  JoinDenied,
  NoPendingJoin,
  PeerAlreadyJoined,
  PeerNotInRoom,
  RoomFull,
  RoomNotFound,
  ServerAtCapacity,
} from './Errors';
import { RoomEvent } from './Events';
import { DisplayName, PeerId, RoomId, SessionToken } from './Identity';
import { Signal } from './Signals';

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

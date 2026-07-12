import { Schema } from 'effect';

import { PeerId, RoomId } from './Identity';

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

import { Schema } from 'effect';

const PeerIdString = Schema.String.check(Schema.isPattern(/^[a-z]{12}$/));
export const PeerId = PeerIdString.pipe(Schema.brand('PeerId'));
export type PeerId = typeof PeerId.Type;

const RoomIdString = Schema.String.check(Schema.isPattern(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/));
export const RoomId = RoomIdString.pipe(Schema.brand('RoomId'));
export type RoomId = typeof RoomId.Type;

export const SessionToken = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
).pipe(Schema.brand('SessionToken'));
export type SessionToken = typeof SessionToken.Type;

const DisplayNameString = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(32));
export const DisplayName = DisplayNameString.pipe(Schema.brand('DisplayName'));
export type DisplayName = typeof DisplayName.Type;

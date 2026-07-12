import { Schema } from 'effect';

const PeerIdString = Schema.String.check(Schema.isPattern(/^[a-z]{12}$/));
const RoomIdString = Schema.String.check(Schema.isPattern(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/));
export const SessionToken = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const DisplayNameString = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(32));

export const PeerId = PeerIdString.pipe(Schema.brand('PeerId'));
export type PeerId = typeof PeerId.Type;

export const RoomId = RoomIdString.pipe(Schema.brand('RoomId'));
export type RoomId = typeof RoomId.Type;

export const DisplayName = DisplayNameString.pipe(Schema.brand('DisplayName'));
export type DisplayName = typeof DisplayName.Type;

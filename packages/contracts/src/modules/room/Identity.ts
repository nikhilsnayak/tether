import { Schema } from 'effect';

const PeerIdString = Schema.String.check(Schema.isPattern(/^[a-z]{12}$/));
export const PeerId = PeerIdString.pipe(Schema.brand('PeerId'));
export type PeerId = typeof PeerId.Type;

const RoomIdString = Schema.String.check(Schema.isPattern(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/));
export const RoomId = RoomIdString.pipe(Schema.brand('RoomId'));
export type RoomId = typeof RoomId.Type;

const RoomTemplateIdString = Schema.String.check(
  Schema.isPattern(/^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/),
);
export const RoomTemplateId = RoomTemplateIdString.pipe(Schema.brand('RoomTemplateId'));
export type RoomTemplateId = typeof RoomTemplateId.Type;

export const DUSK_SUITE_TEMPLATE_ID = RoomTemplateId.make('dusk-suite');
export const DAWN_ATRIUM_TEMPLATE_ID = RoomTemplateId.make('dawn-atrium');

export const SessionToken = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
).pipe(Schema.brand('SessionToken'));
export type SessionToken = typeof SessionToken.Type;

const DisplayNameString = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(32));
export const DisplayName = DisplayNameString.pipe(Schema.brand('DisplayName'));
export type DisplayName = typeof DisplayName.Type;

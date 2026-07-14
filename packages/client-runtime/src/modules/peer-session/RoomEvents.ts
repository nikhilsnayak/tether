import { Result, Schema } from 'effect';

import { utf8ByteLength } from '../../internal/Utf8';

export const ROOM_EVENTS_CHANNEL_LABEL = 'room-events-v1';
export const ROOM_EVENT_VERSION = 1;
export const MAX_ROOM_EVENT_BYTES = 16 * 1024;
export const MAX_CHAT_CODE_POINTS = 4_000;
export const MAX_ROOM_EVENT_COUNTER = 2_147_483_647;
export const AVATAR_WIRE_BOUNDS = {
  minX: -4.35,
  maxX: 4.35,
  minZ: -3.35,
  maxZ: 4.35,
} as const;

const ChatText = Schema.String.check(
  Schema.makeFilter((text) => Array.from(text).length <= MAX_CHAT_CODE_POINTS, {
    description: `a string containing at most ${MAX_CHAT_CODE_POINTS} Unicode code points`,
  }),
);
const Counter = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_ROOM_EVENT_COUNTER }));
const CoordinateX = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: AVATAR_WIRE_BOUNDS.minX, maximum: AVATAR_WIRE_BOUNDS.maxX }),
);
const CoordinateZ = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: AVATAR_WIRE_BOUNDS.minZ, maximum: AVATAR_WIRE_BOUNDS.maxZ }),
);
const CanonicalYaw = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: -Math.PI, maximum: Math.PI }),
);

export const ChatMessageRoomEvent = Schema.Struct({
  version: Schema.Literal(ROOM_EVENT_VERSION),
  type: Schema.Literal('chat-message'),
  text: ChatText,
});

export const AvatarPoseRoomEvent = Schema.Struct({
  version: Schema.Literal(ROOM_EVENT_VERSION),
  type: Schema.Literal('avatar-pose'),
  sequence: Counter,
  x: CoordinateX,
  z: CoordinateZ,
  yaw: CanonicalYaw,
  action: Schema.Literals(['idle', 'walk']),
});

export const MediaStateRoomEvent = Schema.Struct({
  version: Schema.Literal(ROOM_EVENT_VERSION),
  type: Schema.Literal('media-state'),
  revision: Counter,
  cameraOn: Schema.Boolean,
  microphoneOn: Schema.Boolean,
});

export const RoomEventSchema = Schema.Union([
  ChatMessageRoomEvent,
  AvatarPoseRoomEvent,
  MediaStateRoomEvent,
]);
const RoomEventJsonSchema = Schema.fromJsonString(RoomEventSchema);
const decodeRoomEventJson = Schema.decodeUnknownResult(RoomEventJsonSchema, {
  onExcessProperty: 'error',
});
const encodeRoomEventJson = Schema.encodeResult(RoomEventJsonSchema, {
  onExcessProperty: 'error',
});

export type RoomEvent = typeof RoomEventSchema.Type;
export type AvatarPose = Omit<typeof AvatarPoseRoomEvent.Type, 'version' | 'type' | 'sequence'>;
export type SequencedAvatarPose = Omit<typeof AvatarPoseRoomEvent.Type, 'version' | 'type'>;
export type MediaState = Omit<typeof MediaStateRoomEvent.Type, 'version' | 'type' | 'revision'>;
export type RevisionedMediaState = Omit<typeof MediaStateRoomEvent.Type, 'version' | 'type'>;

export type RoomEventCodecError = 'not-text' | 'oversized' | 'invalid-event';

export const takeRoomEventCounter = (
  next: number,
): { readonly value: number; readonly next: number } | null =>
  Number.isSafeInteger(next) && next >= 0 && next <= MAX_ROOM_EVENT_COUNTER
    ? { value: next, next: next + 1 }
    : null;

export const decodeRoomEvent = (input: unknown): Result.Result<RoomEvent, RoomEventCodecError> => {
  if (typeof input !== 'string') return Result.fail('not-text');
  if (utf8ByteLength(input) > MAX_ROOM_EVENT_BYTES) {
    return Result.fail('oversized');
  }

  return Result.mapError(decodeRoomEventJson(input), () => 'invalid-event' as const);
};

export const encodeRoomEvent = (event: RoomEvent): Result.Result<string, RoomEventCodecError> => {
  const encoded = encodeRoomEventJson(event);
  if (Result.isFailure(encoded)) return Result.fail('invalid-event');

  return utf8ByteLength(encoded.success) <= MAX_ROOM_EVENT_BYTES
    ? Result.succeed(encoded.success)
    : Result.fail('oversized');
};

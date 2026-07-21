import { Result, Schema } from 'effect';

import { utf8ByteLength } from '../../internal/Utf8';

export const WATCH_PROTOCOL_VERSION = 1;
export const MAX_WATCH_MESSAGE_BYTES = 4 * 1024;

const WatchSessionIdString = Schema.String.check(Schema.isPattern(/^[a-z0-9-]{8,64}$/));
export const WatchSessionId = WatchSessionIdString.pipe(Schema.brand('WatchSessionId'));
export type WatchSessionId = typeof WatchSessionId.Type;

export const WatchStatus = Schema.Literals(['loaded-paused', 'playing', 'ended']);
export const FailureReason = Schema.Literals(['source', 'attachment', 'pipeline']);
const version = Schema.Literal(WATCH_PROTOCOL_VERSION);

export const HelloWatchMessage = Schema.Struct({
  version,
  type: Schema.Literal('hello'),
  canPresentLocalFile: Schema.Boolean,
  canReceiveProgramMedia: Schema.Boolean,
  canRenderWatch: Schema.Boolean,
  canControlWatch: Schema.Boolean,
});

export const WatchProposedMessage = Schema.Struct({
  version,
  type: Schema.Literal('watch-proposed'),
  watchSessionId: WatchSessionId,
});

export const WatchReadyMessage = Schema.Struct({
  version,
  type: Schema.Literal('watch-ready'),
  watchSessionId: WatchSessionId,
});

export const WatchRejectedMessage = Schema.Struct({
  version,
  type: Schema.Literal('watch-rejected'),
  watchSessionId: WatchSessionId,
  reason: Schema.Literal('busy'),
});

export const WatchControl = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('play') }),
  Schema.Struct({ kind: Schema.Literal('pause') }),
  Schema.Struct({ kind: Schema.Literal('replay') }),
  Schema.Struct({ kind: Schema.Literal('eject') }),
]);

export const ControlRequestedMessage = Schema.Struct({
  version,
  type: Schema.Literal('control-requested'),
  watchSessionId: WatchSessionId,
  control: WatchControl,
});

export const PlaybackStateChangedMessage = Schema.Struct({
  version,
  type: Schema.Literal('playback-state-changed'),
  watchSessionId: WatchSessionId,
  status: WatchStatus,
});

export const WatchFailedMessage = Schema.Struct({
  version,
  type: Schema.Literal('watch-failed'),
  watchSessionId: WatchSessionId,
  reason: FailureReason,
});

export const WatchEndedMessage = Schema.Struct({
  version,
  type: Schema.Literal('watch-ended'),
  watchSessionId: WatchSessionId,
});

export const WatchMessageSchema = Schema.Union([
  HelloWatchMessage,
  WatchProposedMessage,
  WatchReadyMessage,
  WatchRejectedMessage,
  ControlRequestedMessage,
  PlaybackStateChangedMessage,
  WatchFailedMessage,
  WatchEndedMessage,
]);

const WatchMessageJsonSchema = Schema.fromJsonString(WatchMessageSchema);
const decodeWatchMessageJson = Schema.decodeUnknownResult(WatchMessageJsonSchema, {
  onExcessProperty: 'ignore',
});
const encodeWatchMessageJson = Schema.encodeResult(WatchMessageJsonSchema, {
  onExcessProperty: 'error',
});

export type WatchMessage = typeof WatchMessageSchema.Type;
export type WatchControlCommand = typeof WatchControl.Type;
export type WatchStatus = typeof WatchStatus.Type;
export type FailureReason = typeof FailureReason.Type;
export type PlaybackStateChanged = typeof PlaybackStateChangedMessage.Type;

export type WatchMessageCodecError = 'not-text' | 'oversized' | 'invalid-event';

export const decodeWatchMessage = (
  input: unknown,
): Result.Result<WatchMessage, WatchMessageCodecError> => {
  if (typeof input !== 'string') return Result.fail('not-text');
  if (utf8ByteLength(input) > MAX_WATCH_MESSAGE_BYTES) return Result.fail('oversized');
  return Result.mapError(decodeWatchMessageJson(input), () => 'invalid-event' as const);
};

export const encodeWatchMessage = (
  message: WatchMessage,
): Result.Result<string, WatchMessageCodecError> => {
  const encoded = encodeWatchMessageJson(message);
  if (Result.isFailure(encoded)) return Result.fail('invalid-event');
  /* v8 ignore next 3 */
  if (utf8ByteLength(encoded.success) > MAX_WATCH_MESSAGE_BYTES) {
    return Result.fail('oversized');
  }
  return Result.succeed(encoded.success);
};

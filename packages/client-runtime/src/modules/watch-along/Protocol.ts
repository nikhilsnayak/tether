import { Result, Schema } from 'effect';

import { utf8ByteLength } from '../../internal/Utf8';

export const WATCH_PROTOCOL_VERSION = 1;
export const MAX_WATCH_MESSAGE_BYTES = 4 * 1024;
export const MAX_WATCH_COUNTER = 2_147_483_647;

const WatchSessionIdString = Schema.String.check(Schema.isPattern(/^[a-z0-9-]{8,64}$/));
export const WatchSessionId = WatchSessionIdString.pipe(Schema.brand('WatchSessionId'));
export type WatchSessionId = typeof WatchSessionId.Type;

export const NormalizedProgress = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);
const BoundedCounter = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_WATCH_COUNTER }),
);
export const Revision = BoundedCounter;
export const SampleSequence = BoundedCounter;
export const AuthorityEpoch = BoundedCounter;

export const WatchStatus = Schema.Literals(['loaded-paused', 'playing', 'buffering', 'ended']);
export const BufferingReason = Schema.Literals(['source', 'background-throttled']);
export const RejectionReason = Schema.Literals([
  'busy',
  'lost-arbitration',
  'not-ready',
  'unsupported',
]);
export const FailureReason = Schema.Literals(['source', 'attachment', 'pipeline', 'renderer']);

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
  reason: RejectionReason,
});

export const WatchStartedMessage = Schema.Struct({
  version,
  type: Schema.Literal('watch-started'),
  watchSessionId: WatchSessionId,
});

const ControlPlay = Schema.Struct({ kind: Schema.Literal('play') });
const ControlPause = Schema.Struct({ kind: Schema.Literal('pause') });
const ControlSeek = Schema.Struct({ kind: Schema.Literal('seek'), target: NormalizedProgress });
const ControlReplay = Schema.Struct({ kind: Schema.Literal('replay') });
const ControlEject = Schema.Struct({ kind: Schema.Literal('eject') });
export const WatchControl = Schema.Union([
  ControlPlay,
  ControlPause,
  ControlSeek,
  ControlReplay,
  ControlEject,
]);

export const ControlRequestedMessage = Schema.Struct({
  version,
  type: Schema.Literal('control-requested'),
  watchSessionId: WatchSessionId,
  authorityEpoch: AuthorityEpoch,
  baseRevision: Revision,
  control: WatchControl,
});

export const ControlRejectedMessage = Schema.Struct({
  version,
  type: Schema.Literal('control-rejected'),
  watchSessionId: WatchSessionId,
  authorityEpoch: AuthorityEpoch,
  baseRevision: Revision,
});

export const PlaybackStateChangedMessage = Schema.Struct({
  version,
  type: Schema.Literal('playback-state-changed'),
  watchSessionId: WatchSessionId,
  authorityEpoch: AuthorityEpoch,
  revision: Revision,
  status: WatchStatus,
  reason: Schema.optional(BufferingReason),
  progress: NormalizedProgress,
});

export const ProgressSampleMessage = Schema.Struct({
  version,
  type: Schema.Literal('progress-sample'),
  watchSessionId: WatchSessionId,
  authorityEpoch: AuthorityEpoch,
  revision: Revision,
  sequence: SampleSequence,
  progress: NormalizedProgress,
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
  WatchStartedMessage,
  ControlRequestedMessage,
  ControlRejectedMessage,
  PlaybackStateChangedMessage,
  ProgressSampleMessage,
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
export type BufferingReason = typeof BufferingReason.Type;
export type RejectionReason = typeof RejectionReason.Type;
export type FailureReason = typeof FailureReason.Type;
export type Hello = typeof HelloWatchMessage.Type;
export type WatchProposed = typeof WatchProposedMessage.Type;
export type WatchReady = typeof WatchReadyMessage.Type;
export type WatchRejected = typeof WatchRejectedMessage.Type;
export type WatchStarted = typeof WatchStartedMessage.Type;
export type ControlRequested = typeof ControlRequestedMessage.Type;
export type ControlRejected = typeof ControlRejectedMessage.Type;
export type PlaybackStateChanged = typeof PlaybackStateChangedMessage.Type;
export type ProgressSample = typeof ProgressSampleMessage.Type;
export type WatchFailed = typeof WatchFailedMessage.Type;
export type WatchEnded = typeof WatchEndedMessage.Type;

export type WatchMessageCodecError = 'not-text' | 'oversized' | 'invalid-event';

export const decodeWatchMessage = (
  input: unknown,
): Result.Result<WatchMessage, WatchMessageCodecError> => {
  if (typeof input !== 'string') return Result.fail('not-text');
  if (utf8ByteLength(input) > MAX_WATCH_MESSAGE_BYTES) {
    return Result.fail('oversized');
  }

  return Result.mapError(decodeWatchMessageJson(input), () => 'invalid-event' as const);
};

export const encodeWatchMessage = (
  message: WatchMessage,
): Result.Result<string, WatchMessageCodecError> => {
  const encoded = encodeWatchMessageJson(message);
  if (Result.isFailure(encoded)) return Result.fail('invalid-event');

  // Every schema-valid message has a tighter bounded payload than the envelope
  // limit. Keep the post-encode defense in case a future family changes that.
  /* v8 ignore next 3 */
  if (utf8ByteLength(encoded.success) > MAX_WATCH_MESSAGE_BYTES) {
    return Result.fail('oversized');
  }
  return Result.succeed(encoded.success);
};

import { Result } from 'effect';
import { assert, describe, it } from 'vitest';

import {
  ControlRejectedMessage,
  ControlRequestedMessage,
  HelloWatchMessage,
  MAX_WATCH_MESSAGE_BYTES,
  PlaybackStateChangedMessage,
  ProgressSampleMessage,
  WATCH_PROTOCOL_VERSION,
  WatchEndedMessage,
  WatchFailedMessage,
  WatchProposedMessage,
  WatchReadyMessage,
  WatchRejectedMessage,
  WatchSessionId,
  WatchStartedMessage,
  decodeWatchMessage,
  encodeWatchMessage,
  type WatchMessage,
} from './Protocol';

const sid = WatchSessionId.make('session-01');

const progressSample = {
  version: WATCH_PROTOCOL_VERSION,
  type: 'progress-sample',
  watchSessionId: 'session-01',
  authorityEpoch: 1,
  revision: 0,
  sequence: 0,
  progress: 0.5,
} as const;

const roundTrip = (message: WatchMessage) => {
  const encoded = encodeWatchMessage(message);
  assert.isTrue(Result.isSuccess(encoded));
  if (Result.isFailure(encoded)) return;
  assert.deepStrictEqual(decodeWatchMessage(encoded.success), Result.succeed(message));
};

describe('watch-message codec', () => {
  it('round-trips every message family', () => {
    roundTrip({
      version: 1,
      type: 'hello',
      canPresentLocalFile: true,
      canReceiveProgramMedia: true,
      canRenderWatch: true,
      canControlWatch: false,
    });
    roundTrip({ version: 1, type: 'watch-proposed', watchSessionId: sid });
    roundTrip({ version: 1, type: 'watch-ready', watchSessionId: sid });
    roundTrip({ version: 1, type: 'watch-rejected', watchSessionId: sid, reason: 'busy' });
    roundTrip({ version: 1, type: 'watch-started', watchSessionId: sid });
    roundTrip({
      version: 1,
      type: 'control-rejected',
      watchSessionId: sid,
      authorityEpoch: 3,
      baseRevision: 5,
    });
    roundTrip({
      version: 1,
      type: 'playback-state-changed',
      watchSessionId: sid,
      authorityEpoch: 3,
      revision: 5,
      status: 'buffering',
      reason: 'background-throttled',
      progress: 0.25,
    });
    roundTrip({
      version: 1,
      type: 'playback-state-changed',
      watchSessionId: sid,
      authorityEpoch: 3,
      revision: 6,
      status: 'playing',
      progress: 1,
    });
    roundTrip({
      version: 1,
      type: 'progress-sample',
      watchSessionId: sid,
      authorityEpoch: 3,
      revision: 5,
      sequence: 128,
      progress: 0,
    });
    roundTrip({ version: 1, type: 'watch-failed', watchSessionId: sid, reason: 'renderer' });
    roundTrip({ version: 1, type: 'watch-ended', watchSessionId: sid });
  });

  it('round-trips every control-requested variant', () => {
    const base = {
      version: 1,
      type: 'control-requested',
      watchSessionId: sid,
      authorityEpoch: 2,
      baseRevision: 4,
    } as const;
    roundTrip({ ...base, control: { kind: 'play' } });
    roundTrip({ ...base, control: { kind: 'pause' } });
    roundTrip({ ...base, control: { kind: 'seek', target: 0.75 } });
    roundTrip({ ...base, control: { kind: 'replay' } });
    roundTrip({ ...base, control: { kind: 'eject' } });
  });

  // Our codec wraps the schema: it classifies the input and caps bytes BEFORE
  // the schema sees it. Those branches are ours; the schema's own validation is
  // covered once, via a single malformed payload, not re-proven per rule.
  it('classifies decode inputs and caps bytes before parsing', () => {
    assert.deepStrictEqual(decodeWatchMessage(new Uint8Array()), Result.fail('not-text'));
    assert.deepStrictEqual(
      decodeWatchMessage('x'.repeat(MAX_WATCH_MESSAGE_BYTES + 1)),
      Result.fail('oversized'),
    );
    assert.deepStrictEqual(decodeWatchMessage('{'), Result.fail('invalid-event'));
    assert.deepStrictEqual(
      decodeWatchMessage(JSON.stringify({ version: 2, type: 'watch-ended', watchSessionId: sid })),
      Result.fail('invalid-event'),
    );
  });

  it('fails encoding a message that violates the wire contract', () => {
    const hostile = {
      version: 1,
      type: 'progress-sample',
      watchSessionId: sid,
      authorityEpoch: 1,
      revision: 0,
      sequence: 0,
      progress: 1.5,
    } as unknown as WatchMessage;
    assert.isTrue(Result.isFailure(encodeWatchMessage(hostile)));
  });

  // Forward-compat policy is ours: newer peers may add fields; we drop them on
  // decode rather than reject the message.
  it('drops unknown fields from newer clients instead of rejecting', () => {
    assert.deepStrictEqual(
      decodeWatchMessage(
        JSON.stringify({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ended',
          watchSessionId: 'session-01',
          nextFeatureFlag: true,
        }),
      ),
      Result.succeed({ version: 1, type: 'watch-ended', watchSessionId: sid }),
    );
  });

  // Wiring guard, not a re-test of isBetween/isPattern: proves each field kept
  // its intended bound. A typo swapping a bounded field for an unbounded one
  // still typechecks (both are `number`/`string`) but must fail here.
  it('keeps privacy-critical bounds wired to their fields', () => {
    const outOfContract = [
      { ...progressSample, progress: 1.5 },
      { ...progressSample, watchSessionId: 'bad!' },
    ];
    for (const message of outOfContract) {
      assert.deepStrictEqual(
        decodeWatchMessage(JSON.stringify(message)),
        Result.fail('invalid-event'),
      );
    }
  });

  it('carries no local-file metadata on the wire', () => {
    const forbidden = [
      'fileName',
      'filePath',
      'path',
      'size',
      'fileSize',
      'duration',
      'durationMs',
      'codec',
    ];
    const structs = [
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
    ];
    for (const struct of structs) {
      for (const field of Object.keys(struct.fields)) {
        assert.notInclude(forbidden, field);
      }
    }
  });
});

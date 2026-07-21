import { Result } from 'effect';
import { assert, describe, it } from 'vitest';

import {
  MAX_WATCH_MESSAGE_BYTES,
  WATCH_PROTOCOL_VERSION,
  WatchSessionId,
  decodeWatchMessage,
  encodeWatchMessage,
  type WatchMessage,
} from './Protocol';

const sid = WatchSessionId.make('session-01');

const roundTrip = (message: WatchMessage) => {
  const encoded = encodeWatchMessage(message);
  assert.isTrue(Result.isSuccess(encoded));
  if (Result.isFailure(encoded)) return;
  assert.deepStrictEqual(decodeWatchMessage(encoded.success), Result.succeed(message));
};

describe('watch-message codec', () => {
  it('round-trips the minimal protocol', () => {
    roundTrip({
      version: 1,
      type: 'hello',
      canPresentLocalFile: true,
      canReceiveProgramMedia: true,
      canRenderWatch: true,
      canControlWatch: true,
    });
    roundTrip({ version: 1, type: 'watch-proposed', watchSessionId: sid });
    roundTrip({ version: 1, type: 'watch-ready', watchSessionId: sid });
    roundTrip({ version: 1, type: 'watch-rejected', watchSessionId: sid, reason: 'busy' });
    for (const kind of ['play', 'pause', 'replay', 'eject'] as const) {
      roundTrip({
        version: 1,
        type: 'control-requested',
        watchSessionId: sid,
        control: { kind },
      });
    }
    for (const status of ['loaded-paused', 'playing', 'ended'] as const) {
      roundTrip({ version: 1, type: 'playback-state-changed', watchSessionId: sid, status });
    }
    roundTrip({ version: 1, type: 'watch-failed', watchSessionId: sid, reason: 'source' });
    roundTrip({ version: 1, type: 'watch-ended', watchSessionId: sid });
  });

  it('classifies invalid and oversized inputs', () => {
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

  it('rejects invalid outgoing messages', () => {
    const invalid = {
      version: 1,
      type: 'playback-state-changed',
      watchSessionId: sid,
      status: 'buffering',
    } as unknown as WatchMessage;
    assert.isTrue(Result.isFailure(encodeWatchMessage(invalid)));
  });

  it('drops unknown fields without putting file metadata on the wire', () => {
    assert.deepStrictEqual(
      decodeWatchMessage(
        JSON.stringify({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ended',
          watchSessionId: 'session-01',
          fileName: 'private.mp4',
        }),
      ),
      Result.succeed({ version: 1, type: 'watch-ended', watchSessionId: sid }),
    );
  });
});

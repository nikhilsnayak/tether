import { Result } from 'effect';
import { assert, describe, it } from 'vitest';

import {
  AVATAR_WIRE_BOUNDS,
  MAX_CHAT_CODE_POINTS,
  MAX_ROOM_EVENT_BYTES,
  ROOM_EVENT_VERSION,
  decodeRoomEvent,
  encodeRoomEvent,
  takeRoomEventCounter,
  type RoomEvent,
} from './RoomEvents';

const roundTrip = (event: RoomEvent) => {
  const encoded = encodeRoomEvent(event);
  assert.isTrue(Result.isSuccess(encoded));
  if (Result.isFailure(encoded)) return;
  assert.deepStrictEqual(decodeRoomEvent(encoded.success), Result.succeed(event));
};

describe('room-event codec', () => {
  it('round-trips every event family', () => {
    roundTrip({ version: 1, type: 'chat-message', text: 'hello 👋' });
    roundTrip({
      version: 1,
      type: 'avatar-pose',
      sequence: 42,
      x: AVATAR_WIRE_BOUNDS.minX,
      z: AVATAR_WIRE_BOUNDS.maxZ,
      yaw: -Math.PI,
      action: 'walk',
    });
    roundTrip({
      version: 1,
      type: 'media-state',
      revision: 7,
      cameraOn: false,
      microphoneOn: true,
    });
  });

  it('accepts multibyte text at the documented chat code-point limit', () => {
    const result = encodeRoomEvent({
      version: 1,
      type: 'chat-message',
      text: '💜'.repeat(MAX_CHAT_CODE_POINTS),
    });
    assert.isTrue(Result.isSuccess(result));
  });

  it('allocates the final counter without wrapping', () => {
    assert.deepStrictEqual(takeRoomEventCounter(2_147_483_647), {
      value: 2_147_483_647,
      next: 2_147_483_648,
    });
    assert.isNull(takeRoomEventCounter(2_147_483_648));
  });

  it('rejects malformed, non-text, oversized, unknown, and inexact events', () => {
    assert.deepStrictEqual(decodeRoomEvent(new Uint8Array()), Result.fail('not-text'));
    assert.deepStrictEqual(decodeRoomEvent('{'), Result.fail('invalid-event'));
    assert.deepStrictEqual(
      decodeRoomEvent('x'.repeat(MAX_ROOM_EVENT_BYTES + 1)),
      Result.fail('oversized'),
    );

    for (const event of [
      { version: 2, type: 'chat-message', text: 'hello' },
      { version: ROOM_EVENT_VERSION, type: 'unknown', text: 'hello' },
      { version: ROOM_EVENT_VERSION, type: 'chat-message', text: 'hello', surprise: true },
      { version: ROOM_EVENT_VERSION, type: 'chat-message', text: 'x'.repeat(4_001) },
      {
        version: ROOM_EVENT_VERSION,
        type: 'media-state',
        revision: 0,
        cameraOn: 1,
        microphoneOn: true,
      },
    ]) {
      assert.deepStrictEqual(decodeRoomEvent(JSON.stringify(event)), Result.fail('invalid-event'));
    }
  });

  it('rejects hostile avatar values without normalizing them', () => {
    const base = {
      version: ROOM_EVENT_VERSION,
      type: 'avatar-pose',
      sequence: 0,
      x: 0,
      z: 0,
      yaw: 0,
      action: 'idle',
    } as const;

    for (const event of [
      { ...base, sequence: -1 },
      { ...base, sequence: 2_147_483_648 },
      { ...base, sequence: 1.5 },
      { ...base, x: AVATAR_WIRE_BOUNDS.maxX + 0.01 },
      { ...base, z: AVATAR_WIRE_BOUNDS.minZ - 0.01 },
      { ...base, yaw: Math.PI + 0.0001 },
      { ...base, action: 'run' },
      { ...base, x: null },
    ]) {
      assert.deepStrictEqual(decodeRoomEvent(JSON.stringify(event)), Result.fail('invalid-event'));
    }

    assert.isTrue(Result.isFailure(encodeRoomEvent({ ...base, x: Number.NaN })));
    assert.isTrue(Result.isFailure(encodeRoomEvent({ ...base, z: Number.POSITIVE_INFINITY })));
  });
});

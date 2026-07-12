import { assert, describe, it } from '@effect/vitest';
import { Exit, Schema } from 'effect';

import {
  isServerAtCapacity,
  JoinCancelledEvent,
  OpenRoomSessionError,
  RoomSessionOpenedEvent,
  ServerAtCapacity,
} from './index';
import { succeeds } from './test-helpers';

describe('room events and errors', () => {
  it('decodes room events with stable wire identifiers', () => {
    assert.isTrue(
      succeeds(RoomSessionOpenedEvent, {
        _tag: '@tether/RoomSessionOpenedEvent',
        peerId: null,
        sessionToken: 'session-token',
        roomId: 'abc-defg-hij',
      }),
    );
    assert.isTrue(
      succeeds(JoinCancelledEvent, {
        _tag: '@tether/JoinCancelledEvent',
        peerId: 'abcdefghijkl',
      }),
    );
    assert.isFalse(
      succeeds(JoinCancelledEvent, { _tag: '@tether/JoinCancelledEvent', peerId: '' }),
    );
  });

  it('decodes and identifies errors through the RPC error union', () => {
    const exit = Schema.decodeUnknownExit(OpenRoomSessionError)({
      _tag: '@tether/ServerAtCapacity',
    });

    assert.isTrue(Exit.isSuccess(exit));
    if (Exit.isSuccess(exit)) {
      assert.instanceOf(exit.value, ServerAtCapacity);
      assert.isTrue(isServerAtCapacity(exit.value));
    }
  });
});

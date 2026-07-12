import { assert, describe, it } from '@effect/vitest';

import { OpenRoomSessionPayload, SendSignalPayload } from './index';
import { sendSignalPayload, succeeds } from './test-helpers';

describe('room RPC schemas', () => {
  it('accepts host and join session payloads', () => {
    assert.isTrue(
      succeeds(OpenRoomSessionPayload, {
        selfId: 'abcdefghijkl',
        intent: 'host',
      }),
    );
    assert.isTrue(
      succeeds(OpenRoomSessionPayload, {
        selfId: 'abcdefghijkl',
        intent: 'join',
        roomId: 'abc-defg-hij',
        displayName: 'Ada',
      }),
    );
    assert.isTrue(succeeds(SendSignalPayload, sendSignalPayload('session-token')));
  });

  it('rejects payloads that violate the RPC discriminated union', () => {
    assert.isFalse(
      succeeds(OpenRoomSessionPayload, { selfId: 'abcdefghijkl', roomId: 'abc-defg-hij' }),
    );
    assert.isFalse(succeeds(OpenRoomSessionPayload, { selfId: 'abcdefghijkl', intent: 'join' }));
  });
});

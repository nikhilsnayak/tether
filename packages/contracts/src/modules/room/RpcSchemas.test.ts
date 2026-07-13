import { assert, describe, it } from '@effect/vitest';

import {
  GetRoomMetadataPayload,
  GetRoomMetadataSuccess,
  OpenRoomSessionPayload,
  RespondToJoinPayload,
  SendSignalPayload,
} from './index';
import { sendSignalPayload, succeeds } from './test-helpers';

describe('room RPC schemas', () => {
  it('accepts host and join session payloads', () => {
    assert.isTrue(
      succeeds(OpenRoomSessionPayload, {
        selfId: 'abcdefghijkl',
        intent: 'host',
        roomTemplateId: 'dusk-suite',
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
    assert.isTrue(succeeds(GetRoomMetadataPayload, { roomId: 'abc-defg-hij' }));
    assert.isTrue(succeeds(GetRoomMetadataSuccess, { roomTemplateId: 'future-room' }));
    assert.isTrue(
      succeeds(RespondToJoinPayload, {
        roomId: 'abc-defg-hij',
        selfId: 'abcdefghijkl',
        sessionToken: 'session-token',
        peerId: 'mnopqrstuvwx',
        decision: 'allow',
      }),
    );
    assert.isTrue(
      succeeds(RespondToJoinPayload, {
        roomId: 'abc-defg-hij',
        selfId: 'abcdefghijkl',
        sessionToken: 'session-token',
        peerId: 'mnopqrstuvwx',
        decision: 'deny',
      }),
    );
  });

  it('rejects payloads that violate the RPC discriminated union', () => {
    assert.isFalse(
      succeeds(OpenRoomSessionPayload, { selfId: 'abcdefghijkl', roomId: 'abc-defg-hij' }),
    );
    assert.isFalse(succeeds(OpenRoomSessionPayload, { selfId: 'abcdefghijkl', intent: 'join' }));
    assert.isFalse(succeeds(OpenRoomSessionPayload, { selfId: 'abcdefghijkl', intent: 'host' }));
    assert.isFalse(
      succeeds(OpenRoomSessionPayload, {
        selfId: 'abcdefghijkl',
        intent: 'host',
        roomTemplateId: 'Dusk Suite',
      }),
    );
    assert.isFalse(succeeds(OpenRoomSessionPayload, { selfId: 'abcdefghijkl', intent: 'foo' }));
    assert.isFalse(
      succeeds(RespondToJoinPayload, {
        roomId: 'abc-defg-hij',
        selfId: 'abcdefghijkl',
        sessionToken: 'session-token',
        peerId: 'mnopqrstuvwx',
        decision: 'maybe',
      }),
    );
  });
});

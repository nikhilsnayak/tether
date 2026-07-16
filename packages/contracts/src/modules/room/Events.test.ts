import { assert, describe, it } from '@effect/vitest';
import { Exit, Schema } from 'effect';

import {
  isJoinDenied,
  isPeerAlreadyJoined,
  isRoomFull,
  isRoomNotFound,
  isServerAtCapacity,
  isUnsupportedRoomTemplate,
  DetachedEvent,
  JoinCancelledEvent,
  JoinDenied,
  OpenRoomSessionError,
  PeerAlreadyJoined,
  RoomEvent,
  RoomFull,
  RoomNotFound,
  RoomSessionOpenedEvent,
  ServerAtCapacity,
  UnsupportedRoomTemplate,
} from './index';
import { iceCandidate, sessionDescription, succeeds } from './test-helpers';

describe('room events and errors', () => {
  it('decodes room events with stable wire identifiers', () => {
    assert.isTrue(
      succeeds(RoomSessionOpenedEvent, {
        _tag: '@tether/RoomSessionOpenedEvent',
        peerId: null,
        sessionToken: 'session-token',
        roomId: 'abc-defg-hij',
        roomTemplateId: 'dusk-suite',
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
    for (const event of [
      { _tag: '@tether/JoinRequestedEvent', peerId: 'abcdefghijkl', displayName: 'Ada' },
      { _tag: '@tether/JoinPendingEvent' },
      { _tag: '@tether/PeerJoinedEvent', peerId: 'abcdefghijkl' },
      { _tag: '@tether/PeerLeftEvent', peerId: 'abcdefghijkl' },
      {
        _tag: '@tether/SignalReceivedEvent',
        peerId: 'abcdefghijkl',
        signal: sessionDescription('v=0'),
      },
    ]) {
      assert.isTrue(succeeds(RoomEvent, event));
    }
    assert.isTrue(
      succeeds(RoomEvent, {
        _tag: '@tether/SignalReceivedEvent',
        peerId: 'abcdefghijkl',
        signal: iceCandidate('candidate'),
      }),
    );
  });

  it('round-trips detached events through the room event union', () => {
    const event = new DetachedEvent({});
    const encoded = Schema.encodeUnknownSync(RoomEvent)(event);

    assert.deepStrictEqual(encoded, { _tag: '@tether/DetachedEvent' });
    assert.deepStrictEqual(Schema.decodeUnknownSync(RoomEvent)(encoded), event);
  });

  it('decodes and identifies errors through the RPC error union', () => {
    const cases = [
      [RoomFull, isRoomFull, { _tag: '@tether/RoomFull', roomId: 'abc-defg-hij' }],
      [ServerAtCapacity, isServerAtCapacity, { _tag: '@tether/ServerAtCapacity' }],
      [
        PeerAlreadyJoined,
        isPeerAlreadyJoined,
        { _tag: '@tether/PeerAlreadyJoined', roomId: 'abc-defg-hij', peerId: 'abcdefghijkl' },
      ],
      [RoomNotFound, isRoomNotFound, { _tag: '@tether/RoomNotFound', roomId: 'abc-defg-hij' }],
      [JoinDenied, isJoinDenied, { _tag: '@tether/JoinDenied' }],
      [
        UnsupportedRoomTemplate,
        isUnsupportedRoomTemplate,
        { _tag: '@tether/UnsupportedRoomTemplate', roomTemplateId: 'future-room' },
      ],
    ] as const;

    for (const [guard, input] of cases.map(([, guard, input]) => [guard, input] as const)) {
      const exit = Schema.decodeUnknownExit(OpenRoomSessionError)(input);
      assert.isTrue(Exit.isSuccess(exit));
      if (Exit.isSuccess(exit)) {
        assert.isTrue(guard(exit.value));
      }
    }
  });
});

import { assert, describe, it } from '@effect/vitest';
import { Exit, Schema } from 'effect';

import {
  IceCandidateSignal,
  isServerAtCapacity,
  OpenRoomSessionError,
  OpenRoomSessionPayload,
  PeerId,
  RoomId,
  RoomSessionOpenedEvent,
  SendSignalPayload,
  ServerAtCapacity,
  SessionDescriptionSignal,
} from './Schemas';

const succeeds = (schema: Parameters<typeof Schema.decodeUnknownExit>[0], input: unknown) =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

const sessionDescription = (sdp: string) => ({
  _tag: '@tether/SessionDescriptionSignal',
  type: 'offer',
  sdp,
});

const iceCandidate = (
  candidate: string,
  sdpMid: string | null = '0',
  usernameFragment: string | null = 'fragment',
) => ({
  _tag: '@tether/IceCandidateSignal',
  candidate,
  sdpMid,
  sdpMLineIndex: 0,
  usernameFragment,
});

const sendSignalPayload = (sessionToken: string) => ({
  selfId: 'aaaaaaaaaaaa',
  roomId: 'abc-defg-hij',
  sessionToken,
  signal: sessionDescription('v=0'),
});

describe('room wire schemas', () => {
  it('accepts normal current values for every bounded field', () => {
    assert.isTrue(succeeds(PeerId, 'abcdefghijkl'));
    assert.isTrue(succeeds(RoomId, 'abc-defg-hij'));
    assert.isTrue(
      succeeds(RoomSessionOpenedEvent, {
        _tag: '@tether/RoomSessionOpenedEvent',
        peerId: 'abcdefghijkl',
        sessionToken: 'session-token',
      }),
    );
    assert.isTrue(succeeds(SessionDescriptionSignal, sessionDescription('v=0')));
    assert.isTrue(succeeds(IceCandidateSignal, iceCandidate('candidate:1')));
  });

  it('rejects empty values whose minimum is one', () => {
    assert.isFalse(succeeds(PeerId, ''));
    assert.isFalse(succeeds(RoomId, ''));
    assert.isFalse(succeeds(SendSignalPayload, sendSignalPayload('')));
    assert.isFalse(succeeds(SessionDescriptionSignal, sessionDescription('')));
    assert.isFalse(succeeds(IceCandidateSignal, iceCandidate('')));
  });

  it('accepts values exactly at every maximum', () => {
    assert.isTrue(succeeds(SendSignalPayload, sendSignalPayload('t'.repeat(128))));
    assert.isTrue(succeeds(SessionDescriptionSignal, sessionDescription('s'.repeat(262_144))));
    assert.isTrue(succeeds(IceCandidateSignal, iceCandidate('c'.repeat(8_192))));
    assert.isTrue(
      succeeds(IceCandidateSignal, iceCandidate('candidate:1', 'm'.repeat(256), 'u'.repeat(256))),
    );
  });

  it('rejects values one character over every maximum', () => {
    assert.isFalse(succeeds(PeerId, 'p'.repeat(65)));
    assert.isFalse(succeeds(RoomId, 'r'.repeat(65)));
    assert.isFalse(succeeds(SendSignalPayload, sendSignalPayload('t'.repeat(129))));
    assert.isFalse(succeeds(SessionDescriptionSignal, sessionDescription('s'.repeat(262_145))));
    assert.isFalse(succeeds(IceCandidateSignal, iceCandidate('c'.repeat(8_193))));
    assert.isFalse(succeeds(IceCandidateSignal, iceCandidate('candidate:1', 'm'.repeat(257))));
    assert.isFalse(succeeds(IceCandidateSignal, iceCandidate('candidate:1', '0', 'u'.repeat(257))));
  });

  it('keeps nullable ICE fields nullable and permits empty non-null values', () => {
    assert.isTrue(succeeds(IceCandidateSignal, iceCandidate('candidate:1', null, null)));
    assert.isTrue(succeeds(IceCandidateSignal, iceCandidate('candidate:1', '', '')));
  });

  it('decodes complete RPC payloads and events', () => {
    assert.isTrue(
      succeeds(OpenRoomSessionPayload, {
        selfId: 'abcdefghijkl',
        roomId: 'abc-defg-hij',
      }),
    );
    assert.isTrue(succeeds(SendSignalPayload, sendSignalPayload('session-token')));
    assert.isTrue(
      succeeds(RoomSessionOpenedEvent, {
        _tag: '@tether/RoomSessionOpenedEvent',
        peerId: null,
        sessionToken: 'session-token',
      }),
    );
  });

  it('rejects malformed room and peer identifiers', () => {
    for (const value of [
      'ABCDEFGHIJKL',
      'abcdefghijk1',
      'abcdefghijk',
      'abcdefghijklm',
      ' abcdefghijkl',
    ]) {
      assert.isFalse(succeeds(PeerId, value));
    }
    for (const value of [
      'ABC-DEFG-HIJ',
      'abc_defg_hij',
      'abc-def1-hij',
      'ab-defg-hij',
      'abc-defg-hijk',
      ' abc-defg-hij',
    ]) {
      assert.isFalse(succeeds(RoomId, value));
    }
  });

  it('decodes and identifies the server capacity error through the RPC error union', () => {
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

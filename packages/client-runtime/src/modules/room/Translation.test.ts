import { assert, describe, it } from '@effect/vitest';
import {
  DUSK_SUITE_TEMPLATE_ID,
  DetachedEvent,
  DisplayName,
  IceCandidateSignal,
  JoinCancelledEvent,
  JoinPendingEvent,
  JoinRequestedEvent,
  PeerId,
  PeerJoinedEvent,
  PeerLeftEvent,
  RoomId,
  RoomSessionOpenedEvent,
  SessionDescriptionSignal,
  SessionToken,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';

import { translateRoomEventData } from './Translation';

const peerId = PeerId.make('bbbbbbbbbbbb');
const roomId = RoomId.make('abc-defg-hij');
const sessionToken = SessionToken.make('session-token');

describe('translateRoomEventData', () => {
  it('translates a room opening into session, UI, and authentication data', () => {
    assert.deepStrictEqual(
      translateRoomEventData(
        new RoomSessionOpenedEvent({
          peerId: null,
          roomId,
          roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
          sessionToken,
        }),
      ),
      {
        input: { _tag: 'RoomSessionOpened', peerId: null },
        uiEvent: { _tag: 'RoomOpened', roomId, roomTemplateId: DUSK_SUITE_TEMPLATE_ID },
        openedSession: { roomId, sessionToken },
      },
    );
  });

  it('translates peer lifecycle events into actor inputs', () => {
    assert.deepStrictEqual(translateRoomEventData(new PeerJoinedEvent({ peerId })), {
      input: { _tag: 'PeerJoined', peerId },
      uiEvent: null,
      openedSession: null,
    });
    assert.deepStrictEqual(translateRoomEventData(new PeerLeftEvent({ peerId })), {
      input: { _tag: 'PeerLeft', peerId },
      uiEvent: null,
      openedSession: null,
    });
  });

  it('translates session descriptions and ICE candidates', () => {
    assert.deepStrictEqual(
      translateRoomEventData(
        new SignalReceivedEvent({
          peerId,
          signal: new SessionDescriptionSignal({
            type: 'offer',
            sdp: 'offer-sdp',
            negotiationEpoch: 2,
          }),
        }),
      ).input,
      {
        _tag: 'SignalReceived',
        peerId,
        signal: {
          _tag: 'SessionDescription',
          type: 'offer',
          sdp: 'offer-sdp',
          negotiationEpoch: 2,
        },
      },
    );
    assert.deepStrictEqual(
      translateRoomEventData(
        new SignalReceivedEvent({
          peerId,
          signal: new IceCandidateSignal({
            candidate: 'candidate:1',
            sdpMid: null,
            sdpMLineIndex: null,
            usernameFragment: null,
            negotiationEpoch: 2,
          }),
        }),
      ).input,
      {
        _tag: 'SignalReceived',
        peerId,
        signal: {
          _tag: 'IceCandidate',
          candidate: 'candidate:1',
          sdpMid: null,
          sdpMLineIndex: null,
          usernameFragment: null,
          negotiationEpoch: 2,
        },
      },
    );
  });

  it('translates admission events into UI events', () => {
    const displayName = DisplayName.make('Bob');
    assert.deepStrictEqual(
      translateRoomEventData(new JoinRequestedEvent({ peerId, displayName })).uiEvent,
      { _tag: 'JoinRequestReceived', peerId, displayName },
    );
    assert.deepStrictEqual(translateRoomEventData(new JoinPendingEvent({})).uiEvent, {
      _tag: 'JoinPending',
    });
    assert.deepStrictEqual(translateRoomEventData(new JoinCancelledEvent({ peerId })).uiEvent, {
      _tag: 'JoinRequestCancelled',
      peerId,
    });
  });

  it('ignores detached events until the client detachment protocol is implemented', () => {
    assert.deepStrictEqual(translateRoomEventData(new DetachedEvent({})), {
      input: null,
      uiEvent: null,
      openedSession: null,
    });
  });
});

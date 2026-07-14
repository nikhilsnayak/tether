import {
  DisplayName,
  DUSK_SUITE_TEMPLATE_ID,
  PeerId,
  RoomId,
} from '@tether/contracts/modules/room';
import { assert, describe, it } from 'vitest';

import { type MediaStreamHandle, type PeerSessionEvent, type PeerSessionView } from './Model';
import { initialPeerSessionView, reducePeerSessionView } from './View';

const connectedView: PeerSessionView = {
  status: 'connected',
  messages: [],
  roomEventsReady: true,
  remoteAvatarPose: null,
  remoteMediaState: null,
  sas: '11111 22222 33333 44444 55555',
  pendingJoinRequests: [],
  roomId: null,
  roomTemplateId: null,
};
const peerId = PeerId.make('pppppppppppp');

describe('reducePeerSessionView', () => {
  it('keeps media handles outside the serializable view', () => {
    const stream: MediaStreamHandle = { value: {} };

    assert.strictEqual(
      reducePeerSessionView(connectedView, { _tag: 'LocalStreamReady', stream }),
      connectedView,
    );
    assert.strictEqual(
      reducePeerSessionView(connectedView, { _tag: 'RemoteStreamReady', stream }),
      connectedView,
    );
  });

  it('projects transport lifecycle events', () => {
    const events: ReadonlyArray<readonly [PeerSessionEvent, PeerSessionView['status']]> = [
      [{ _tag: 'TransportLost', peerId }, 'transport-lost'],
      [{ _tag: 'NegotiationStalled', peerId }, 'negotiation-stalled'],
      [{ _tag: 'PeerInterrupted', peerId }, 'reconnecting'],
      [{ _tag: 'PeerRestored', peerId }, 'connected'],
    ];

    for (const [event, status] of events) {
      assert.strictEqual(reducePeerSessionView(connectedView, event).status, status);
    }
  });

  it('clears connection-specific state when transport is replaced', () => {
    const interrupted = reducePeerSessionView(connectedView, {
      _tag: 'PeerInterrupted',
      peerId,
    });
    const lost = reducePeerSessionView(connectedView, {
      _tag: 'TransportLost',
      peerId,
    });
    const disconnected = reducePeerSessionView(connectedView, {
      _tag: 'SignalingDisconnected',
    });
    const failed = reducePeerSessionView(connectedView, {
      _tag: 'SessionFailed',
    });

    assert.deepStrictEqual(interrupted, {
      ...connectedView,
      status: 'reconnecting',
      roomEventsReady: false,
      sas: null,
    });
    assert.deepStrictEqual(lost, {
      ...connectedView,
      status: 'transport-lost',
      roomEventsReady: false,
      sas: null,
    });
    assert.isNull(disconnected.sas);
    assert.isNull(failed.sas);
  });

  it('projects room-event families independently and freezes them during reconnect', () => {
    const pose = { sequence: 4, x: 1, z: 2, yaw: 0.5, action: 'walk' as const };
    const mediaState = { revision: 7, cameraOn: false, microphoneOn: true };
    const withPose = reducePeerSessionView(connectedView, {
      _tag: 'RemoteAvatarPoseChanged',
      pose,
    });
    assert.strictEqual(withPose.remoteAvatarPose, pose);
    assert.isNull(withPose.remoteMediaState);
    assert.deepStrictEqual(withPose.messages, []);

    const withMedia = reducePeerSessionView(withPose, {
      _tag: 'RemoteMediaStateChanged',
      mediaState,
    });
    assert.strictEqual(withMedia.remoteAvatarPose, pose);
    assert.strictEqual(withMedia.remoteMediaState, mediaState);

    const unavailable = reducePeerSessionView(withMedia, {
      _tag: 'RoomEventsUnavailable',
    });
    assert.strictEqual(unavailable.remoteAvatarPose, pose);
    assert.isNull(unavailable.remoteMediaState);

    const reconnecting = reducePeerSessionView(withMedia, {
      _tag: 'PeerInterrupted',
      peerId,
    });
    assert.isFalse(reconnecting.roomEventsReady);
    assert.strictEqual(reconnecting.remoteAvatarPose, pose);
    assert.strictEqual(reconnecting.remoteMediaState, mediaState);

    const departed = reducePeerSessionView(reconnecting, {
      _tag: 'PeerDeparted',
      peerId,
    });
    assert.isNull(departed.remoteAvatarPose);
    assert.isNull(departed.remoteMediaState);

    const lost = reducePeerSessionView(withMedia, { _tag: 'TransportLost', peerId });
    assert.isNull(lost.remoteAvatarPose);
    assert.isNull(lost.remoteMediaState);
  });

  it('starts from the initial projection', () => {
    assert.strictEqual(
      reducePeerSessionView(connectedView, { _tag: 'SessionStarted' }),
      initialPeerSessionView,
    );
  });

  it('projects a server-capacity rejection', () => {
    assert.strictEqual(
      reducePeerSessionView(connectedView, {
        _tag: 'RoomJoinRejected',
        reason: 'server-at-capacity',
      }).status,
      'server-at-capacity',
    );
  });

  it('records the room id and template when the room opens', () => {
    const roomId = RoomId.make('abc-defg-hij');

    const view = reducePeerSessionView(initialPeerSessionView, {
      _tag: 'RoomOpened',
      roomId,
      roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
    });
    assert.strictEqual(view.roomId, roomId);
    assert.strictEqual(view.roomTemplateId, DUSK_SUITE_TEMPLATE_ID);
  });

  it('marks the joiner as awaiting host approval', () => {
    assert.strictEqual(
      reducePeerSessionView(initialPeerSessionView, { _tag: 'JoinPending' }).status,
      'awaiting-approval',
    );
  });

  it('records the knocking joiner as a pending request', () => {
    const displayName = DisplayName.make('Bob');

    assert.deepStrictEqual(
      reducePeerSessionView(initialPeerSessionView, {
        _tag: 'JoinRequestReceived',
        peerId,
        displayName,
      }).pendingJoinRequests,
      [{ peerId, displayName }],
    );
  });

  it('preserves concurrent knocks in arrival order', () => {
    const bobName = DisplayName.make('Bob');
    const other = PeerId.make('oooooooooooo');
    const otherName = DisplayName.make('Other');
    const first = reducePeerSessionView(initialPeerSessionView, {
      _tag: 'JoinRequestReceived',
      peerId,
      displayName: bobName,
    });
    const second = reducePeerSessionView(first, {
      _tag: 'JoinRequestReceived',
      peerId: other,
      displayName: otherName,
    });

    assert.deepStrictEqual(second.pendingJoinRequests, [
      { peerId, displayName: bobName },
      { peerId: other, displayName: otherName },
    ]);
    assert.strictEqual(
      reducePeerSessionView(second, {
        _tag: 'JoinRequestReceived',
        peerId,
        displayName: bobName,
      }),
      second,
    );
  });

  it('removes only the withdrawn or handled knock', () => {
    const other = PeerId.make('oooooooooooo');
    const first = reducePeerSessionView(initialPeerSessionView, {
      _tag: 'JoinRequestReceived',
      peerId,
      displayName: DisplayName.make('Bob'),
    });
    const pending = reducePeerSessionView(first, {
      _tag: 'JoinRequestReceived',
      peerId: other,
      displayName: DisplayName.make('Other'),
    });

    assert.deepStrictEqual(
      reducePeerSessionView(pending, { _tag: 'JoinRequestCancelled', peerId }).pendingJoinRequests,
      [{ peerId: other, displayName: DisplayName.make('Other') }],
    );
    assert.deepStrictEqual(
      reducePeerSessionView(pending, { _tag: 'JoinRequestHandled', peerId: other })
        .pendingJoinRequests,
      [{ peerId, displayName: DisplayName.make('Bob') }],
    );
    const unknown = PeerId.make('uuuuuuuuuuuu');
    assert.strictEqual(
      reducePeerSessionView(pending, { _tag: 'JoinRequestHandled', peerId: unknown }),
      pending,
    );
  });

  it('projects the new join rejection reasons', () => {
    const reasons: ReadonlyArray<'room-not-found' | 'join-denied'> = [
      'room-not-found',
      'join-denied',
    ];

    for (const reason of reasons) {
      assert.strictEqual(
        reducePeerSessionView(connectedView, { _tag: 'RoomJoinRejected', reason }).status,
        reason,
      );
    }
  });
});

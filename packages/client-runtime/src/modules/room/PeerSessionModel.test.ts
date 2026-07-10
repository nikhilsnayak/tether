import { DisplayName, PeerId, RoomId } from '@tether/contracts/modules/room';
import { assert, describe, it } from 'vitest';

import {
  initialPeerSessionView,
  isPlatformError,
  PlatformError,
  reducePeerSessionView,
  type MediaStreamHandle,
  type PeerSessionEvent,
  type PeerSessionView,
} from './PeerSessionModel';

const connectedView: PeerSessionView = {
  status: 'connected',
  messages: [],
  chatReady: true,
  sas: '11111 22222 33333 44444 55555',
  pendingJoinRequests: [],
  roomId: null,
};
const peerId = PeerId.make('pppppppppppp');

describe('reducePeerSessionView', () => {
  it('identifies platform errors', () => {
    assert.isTrue(
      isPlatformError(new PlatformError({ operation: 'create-offer', cause: 'failed' })),
    );
    assert.isFalse(isPlatformError(new Error('failed')));
  });

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

    assert.deepStrictEqual(interrupted, {
      ...connectedView,
      status: 'reconnecting',
      chatReady: false,
      sas: null,
    });
    assert.deepStrictEqual(lost, {
      ...connectedView,
      status: 'transport-lost',
      chatReady: false,
      sas: null,
    });
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

  it('records the minted room id when the room opens', () => {
    const roomId = RoomId.make('abc-defg-hij');

    assert.strictEqual(
      reducePeerSessionView(initialPeerSessionView, { _tag: 'RoomOpened', roomId }).roomId,
      roomId,
    );
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

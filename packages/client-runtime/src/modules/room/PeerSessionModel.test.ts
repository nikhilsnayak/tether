import { PeerId } from '@tether/contracts/modules/room';
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
});

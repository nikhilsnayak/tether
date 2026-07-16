import { assert, describe, it } from 'vitest';

import type { PeerSessionView } from '../peer-session/Model';
import { isPeerSessionErrorStatus, peerSessionStatusPresentation } from './PeerSessionPresentation';

const statuses: ReadonlyArray<PeerSessionView['status']> = [
  'connecting',
  'connected',
  'reconnecting',
  'disconnected',
  'failed',
  'transport-lost',
  'negotiation-stalled',
  'room-full',
  'server-at-capacity',
  'peer-already-joined',
  'room-not-found',
  'join-denied',
  'awaiting-approval',
  'waiting-for-peer',
  'peer-departed',
];

describe('PeerSessionPresentation', () => {
  it('provides complete display content for every status', () => {
    for (const status of statuses) {
      const presentation = peerSessionStatusPresentation(status, false);

      assert.isNotEmpty(presentation.label);
      assert.isNotEmpty(presentation.hint);
      assert.isFalse(presentation.direct);
    }
  });

  it('classifies terminal error statuses', () => {
    assert.deepStrictEqual(statuses.filter(isPeerSessionErrorStatus), [
      'disconnected',
      'failed',
      'room-full',
      'server-at-capacity',
      'peer-already-joined',
      'room-not-found',
      'join-denied',
    ]);
  });

  it('treats a declined or missing room as an error but awaiting approval as transient', () => {
    assert.isTrue(isPeerSessionErrorStatus('room-not-found'));
    assert.isTrue(isPeerSessionErrorStatus('join-denied'));
    assert.isFalse(isPeerSessionErrorStatus('awaiting-approval'));
  });

  it('presents server capacity without room-specific guidance', () => {
    assert.deepStrictEqual(peerSessionStatusPresentation('server-at-capacity', false), {
      tone: 'destructive',
      pulse: false,
      label: 'Service is busy',
      hint: 'Tether has reached its current call capacity. Try again shortly.',
      direct: false,
    });
  });

  it('presents a connected detached call as direct', () => {
    assert.deepStrictEqual(peerSessionStatusPresentation('connected', true), {
      tone: 'success',
      pulse: false,
      label: 'Connected',
      hint: 'Direct connection. The call no longer uses the Tether server.',
      direct: true,
    });
  });

  it('does not promise recovery after a detached transport failure', () => {
    assert.deepStrictEqual(peerSessionStatusPresentation('transport-lost', true), {
      tone: 'warning',
      pulse: false,
      label: 'Connection lost',
      hint: 'The direct connection failed. Create a new room to reconnect.',
      direct: false,
    });
  });

  it('does not promise rejoining after a detached peer departure', () => {
    assert.deepStrictEqual(peerSessionStatusPresentation('peer-departed', true), {
      tone: 'warning',
      pulse: false,
      label: 'They left the call',
      hint: 'This room has ended. Create a new room to talk again.',
      direct: false,
    });
  });
});

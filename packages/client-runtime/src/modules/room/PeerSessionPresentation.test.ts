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
];

describe('PeerSessionPresentation', () => {
  it('provides complete display content for every status', () => {
    for (const status of statuses) {
      const presentation = peerSessionStatusPresentation(status);

      assert.isNotEmpty(presentation.label);
      assert.isNotEmpty(presentation.hint);
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
    assert.deepStrictEqual(peerSessionStatusPresentation('server-at-capacity'), {
      tone: 'destructive',
      pulse: false,
      label: 'Service is busy',
      hint: 'Tether has reached its current call capacity. Try again shortly.',
    });
  });
});

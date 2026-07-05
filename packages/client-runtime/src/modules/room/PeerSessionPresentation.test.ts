import { assert, describe, it } from 'vitest';

import type { PeerSessionView } from './PeerSessionModel';
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
  'peer-already-joined',
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
      'peer-already-joined',
    ]);
  });
});

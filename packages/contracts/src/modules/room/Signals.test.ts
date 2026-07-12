import { assert, describe, it } from '@effect/vitest';

import { IceCandidateSignal, SessionDescriptionSignal } from './index';
import { iceCandidate, sessionDescription, succeeds } from './test-helpers';

describe('room signaling schemas', () => {
  it('accepts valid session descriptions and ICE candidates', () => {
    assert.isTrue(succeeds(SessionDescriptionSignal, sessionDescription('v=0')));
    assert.isTrue(succeeds(IceCandidateSignal, iceCandidate('candidate:1')));
    assert.isTrue(succeeds(IceCandidateSignal, iceCandidate('candidate:1', null, null)));
  });

  it('rejects missing or invalid negotiation data', () => {
    assert.isFalse(succeeds(SessionDescriptionSignal, sessionDescription('')));
    assert.isFalse(succeeds(IceCandidateSignal, iceCandidate('')));

    for (const negotiationEpoch of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.isFalse(
        succeeds(SessionDescriptionSignal, {
          ...sessionDescription('v=0'),
          negotiationEpoch,
        }),
      );
    }

    const { negotiationEpoch: _epoch, ...withoutEpoch } = sessionDescription('v=0');
    assert.isFalse(succeeds(SessionDescriptionSignal, withoutEpoch));
  });
});

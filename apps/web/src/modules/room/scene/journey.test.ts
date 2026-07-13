import { describe, expect, it } from 'vitest';

import { roomJourneyCue } from './journey';

describe('roomJourneyCue', () => {
  it.each([
    ['host', 'waiting-for-peer', false, 'waiting'],
    ['join', 'awaiting-approval', false, 'outside'],
    ['host', 'connecting', false, 'screen-connecting'],
    ['host', 'connected', false, 'screen-connecting'],
    ['host', 'connected', true, 'screen-live'],
    ['join', 'reconnecting', true, 'screen-reconnecting'],
    ['join', 'transport-lost', true, 'screen-reconnecting'],
    ['host', 'negotiation-stalled', false, 'screen-connecting'],
    ['host', 'failed', false, 'screen-ended'],
    ['join', 'join-denied', false, 'screen-ended'],
  ] as const)('%s / %s maps to %s', (intent, status, hasRemoteStream, expected) => {
    expect(roomJourneyCue(intent, status, hasRemoteStream)).toBe(expected);
  });
});

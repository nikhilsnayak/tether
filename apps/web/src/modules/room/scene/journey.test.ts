import type { PeerSessionView } from '@tether/client-runtime/modules/peer-session';
import { describe, expect, it } from 'vitest';

import { nextUnannouncedPeerId, roomJourneyCue, roomJourneyLabel, roomTransition } from './journey';

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

describe('roomJourneyCue', () => {
  it.each([
    ['host', 'waiting-for-peer', false, 'waiting'],
    ['join', 'awaiting-approval', false, 'outside'],
    ['host', 'connecting', false, 'screen-connecting'],
    ['host', 'connected', false, 'screen-connecting'],
    ['host', 'connected', true, 'screen-live'],
    ['join', 'reconnecting', true, 'screen-reconnecting'],
    ['join', 'transport-lost', true, 'screen-reconnecting'],
    ['host', 'negotiation-stalled', false, 'screen-stalled'],
    ['host', 'failed', false, 'screen-ended'],
    ['join', 'join-denied', false, 'screen-ended'],
  ] as const)('%s / %s maps to %s', (intent, status, hasRemoteStream, expected) => {
    expect(roomJourneyCue(intent, status, hasRemoteStream)).toBe(expected);
  });

  it('distinguishes a guest peer departure from the initial waiting state', () => {
    expect(roomJourneyCue('join', 'peer-departed', false)).toBe('screen-departed');
    expect(roomJourneyCue('host', 'peer-departed', false)).toBe('waiting');
    expect(roomJourneyCue('join', 'waiting-for-peer', false)).toBe('waiting');
  });

  it('uses immediate placement instead of camera travel for reduced motion', () => {
    expect(roomTransition('outside', 'screen-connecting', false)).toEqual({
      kind: 'enter',
      durationMs: 900,
    });
    expect(roomTransition('outside', 'screen-connecting', true)).toEqual({
      kind: 'none',
      durationMs: 0,
    });
  });

  it('announces queued requests once and in queue order', () => {
    const requests = [{ peerId: 'first' }, { peerId: 'second' }] as const;
    expect(nextUnannouncedPeerId(requests, new Set())).toBe('first');
    expect(nextUnannouncedPeerId(requests, new Set(['first']))).toBe('second');
    expect(nextUnannouncedPeerId(requests, new Set(['first', 'second']))).toBeNull();
  });

  it('maps every runtime status to readable display content', () => {
    for (const status of statuses) {
      const cue = roomJourneyCue('join', status, status === 'connected');
      expect(roomJourneyLabel(cue)).not.toBe('');
    }
  });
});

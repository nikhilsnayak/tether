import type { PeerSessionView } from '@tether/client-runtime/modules/peer-session';
import { describe, expect, it } from 'vitest';

import {
  doorTransition,
  doorTransitionOpenness,
  roomJourneyCue,
  roomJourneyLabel,
  roomTransition,
} from './journey';

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
    ['host', 'waiting-for-peer', 'waiting'],
    ['join', 'awaiting-approval', 'outside'],
    ['host', 'connecting', 'connecting'],
    ['host', 'connected', 'together'],
    ['join', 'reconnecting', 'reconnecting'],
    ['join', 'transport-lost', 'reconnecting'],
    ['host', 'negotiation-stalled', 'stalled'],
    ['host', 'failed', 'ended'],
    ['join', 'join-denied', 'ended'],
  ] as const)('%s / %s maps to %s', (intent, status, expected) => {
    expect(roomJourneyCue(intent, status)).toBe(expected);
  });

  it('distinguishes a guest peer departure from the initial waiting state', () => {
    expect(roomJourneyCue('join', 'peer-departed')).toBe('departed');
    expect(roomJourneyCue('host', 'peer-departed')).toBe('waiting');
    expect(roomJourneyCue('join', 'waiting-for-peer')).toBe('waiting');
  });

  it('does not use remote media availability to choose the spatial state', () => {
    expect(roomJourneyCue('host', 'connected')).toBe('together');
  });

  it('maps every runtime status to readable display content', () => {
    for (const status of statuses) {
      expect(roomJourneyLabel(roomJourneyCue('join', status))).not.toBe('');
    }
  });
});

describe('roomTransition', () => {
  it('moves an admitted guest inside, including a coalesced connection', () => {
    expect(roomTransition('outside', 'connecting', false)).toEqual({
      kind: 'enter',
      durationMs: 900,
    });
    expect(roomTransition('outside', 'together', false)).toEqual({
      kind: 'enter',
      durationMs: 900,
    });
  });

  it('uses immediate placement for reduced motion', () => {
    expect(roomTransition('outside', 'connecting', true)).toEqual({ kind: 'none', durationMs: 0 });
    expect(roomTransition('waiting', 'waiting', false)).toEqual({ kind: 'none', durationMs: 0 });
  });
});

describe('doorTransition', () => {
  it.each([
    ['waiting', 'connecting'],
    ['waiting', 'together'],
    ['outside', 'connecting'],
    ['outside', 'together'],
  ] as const)('admits for %s → %s', (previous, next) => {
    expect(doorTransition(previous, next, false)).toEqual({ kind: 'admit', durationMs: 1_800 });
  });

  it.each([
    ['outside', 'ended'],
    ['outside', 'reconnecting'],
    ['reconnecting', 'together'],
    ['together', 'reconnecting'],
    ['connecting', 'stalled'],
    ['connecting', 'connecting'],
    ['together', 'waiting'],
  ] as const)('stays closed for %s → %s', (previous, next) => {
    expect(doorTransition(previous, next, false)).toEqual({ kind: 'none', durationMs: 0 });
  });

  it('does not animate admission with reduced motion', () => {
    expect(doorTransition('outside', 'connecting', true)).toEqual({ kind: 'none', durationMs: 0 });
  });

  it('opens, holds, and closes exactly at the end of admission', () => {
    const transition = doorTransition('outside', 'connecting', false);
    expect(doorTransitionOpenness(transition, 0)).toBe(0);
    expect(doorTransitionOpenness(transition, 315)).toBeGreaterThan(0);
    expect(doorTransitionOpenness(transition, 315)).toBeLessThan(1);
    expect(doorTransitionOpenness(transition, 630)).toBe(1);
    expect(doorTransitionOpenness(transition, 900)).toBe(1);
    expect(doorTransitionOpenness(transition, 1_440)).toBeGreaterThan(0);
    expect(doorTransitionOpenness(transition, 1_800)).toBe(0);
    expect(doorTransitionOpenness(transition, 2_000)).toBe(0);
  });

  it('keeps every non-admission transition closed', () => {
    expect(doorTransitionOpenness({ kind: 'none', durationMs: 0 }, 900)).toBe(0);
  });
});

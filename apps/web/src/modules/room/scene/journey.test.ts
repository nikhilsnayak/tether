import type { PeerSessionView } from '@tether/client-runtime/modules/peer-session';
import { describe, expect, it } from 'vitest';

import {
  doorTransition,
  doorTransitionOpenness,
  resolveDoorTransition,
  resolveRoomTransition,
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
    ['join', 'connecting', 'outside'],
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
    expect(roomJourneyLabel('connecting')).toBe('Connecting');
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
    expect(roomTransition('waiting', 'connecting', false)).toEqual({
      kind: 'enter',
      durationMs: 900,
    });
  });

  it('preserves an active entrance while connecting becomes together', () => {
    const active = roomTransition('waiting', 'connecting', false);

    expect(
      resolveRoomTransition({ kind: 'none', durationMs: 0 }, 'outside', 'connecting', false),
    ).toEqual(active);
    expect(resolveRoomTransition(active, 'connecting', 'together', false)).toBe(active);
  });

  it('aborts an active entrance when connection stalls or reduced motion is enabled', () => {
    const active = roomTransition('waiting', 'connecting', false);

    expect(resolveRoomTransition(active, 'connecting', 'stalled', false)).toEqual({
      kind: 'none',
      durationMs: 0,
    });
    expect(resolveRoomTransition(active, 'connecting', 'together', true)).toEqual({
      kind: 'none',
      durationMs: 0,
    });
    expect(
      resolveRoomTransition({ kind: 'none', durationMs: 0 }, 'outside', 'ended', false),
    ).toEqual({ kind: 'none', durationMs: 0 });
  });

  it('uses immediate placement for reduced motion', () => {
    expect(roomTransition('outside', 'connecting', true)).toEqual({ kind: 'none', durationMs: 0 });
    expect(roomTransition('waiting', 'waiting', false)).toEqual({ kind: 'none', durationMs: 0 });
  });
});

describe('doorTransition', () => {
  it.each([
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
    ['waiting', 'together'],
  ] as const)('stays closed for %s → %s', (previous, next) => {
    expect(doorTransition(previous, next, false)).toEqual({ kind: 'none', durationMs: 0 });
  });

  it('stays closed while the host starts a room from media setup', () => {
    expect(doorTransition('waiting', 'connecting', false)).toEqual({
      kind: 'none',
      durationMs: 0,
    });
  });

  it('does not animate admission with reduced motion', () => {
    expect(doorTransition('outside', 'connecting', true)).toEqual({ kind: 'none', durationMs: 0 });
  });

  it('preserves an active admission when connecting becomes together', () => {
    const active = doorTransition('outside', 'connecting', false);

    expect(
      resolveDoorTransition({ kind: 'none', durationMs: 0 }, 'outside', 'connecting', false),
    ).toEqual(active);
    expect(resolveDoorTransition(active, 'connecting', 'together', false)).toBe(active);
    expect(doorTransitionOpenness(active, 900)).toBe(1);
  });

  it('aborts an active admission when connection stalls or reduced motion is enabled', () => {
    const active = doorTransition('outside', 'connecting', false);

    expect(resolveDoorTransition(active, 'connecting', 'stalled', false)).toEqual({
      kind: 'none',
      durationMs: 0,
    });
    expect(resolveDoorTransition(active, 'connecting', 'together', true)).toEqual({
      kind: 'none',
      durationMs: 0,
    });
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

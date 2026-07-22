import type { PeerSessionView, RoomSession } from '@tether/client-runtime/modules/peer-session';

import type { RoomEntryState } from '../entry/room-entry-state';

export type RoomJourneyCue =
  | 'waiting'
  | 'outside'
  | 'connecting'
  | 'stalled'
  | 'together'
  | 'reconnecting'
  | 'departed'
  | 'ended';

export type RoomTransition =
  | { readonly kind: 'none'; readonly durationMs: 0 }
  | { readonly kind: 'enter'; readonly durationMs: number };

export type DoorTransition =
  | { readonly kind: 'none'; readonly durationMs: 0 }
  | { readonly kind: 'admit'; readonly durationMs: number };

const ADMISSION_DURATION_MS = 1_800;
const ADMISSION_OPEN_FRACTION = 0.35;
const ADMISSION_CLOSE_FRACTION = 0.6;

export function roomJourneyCue(
  intent: RoomSession['intent'],
  status: PeerSessionView['status'],
): RoomJourneyCue {
  switch (status) {
    case 'disconnected':
    case 'failed':
    case 'room-full':
    case 'server-at-capacity':
    case 'peer-already-joined':
    case 'room-not-found':
    case 'join-denied':
      return 'ended';
    case 'awaiting-approval':
      return 'outside';
    case 'peer-departed':
      return intent === 'join' ? 'departed' : 'waiting';
    case 'waiting-for-peer':
      return 'waiting';
    case 'reconnecting':
    case 'transport-lost':
      return 'reconnecting';
    case 'negotiation-stalled':
      return 'stalled';
    case 'connecting':
      return intent === 'join' ? 'outside' : 'connecting';
    case 'connected':
      return 'together';
  }
}

export function resolveRoomJourney({
  entryStage,
  intent,
  active,
  status,
}: {
  readonly entryStage: RoomEntryState['_tag'];
  readonly intent: RoomSession['intent'];
  readonly active: boolean;
  readonly status: PeerSessionView['status'];
}): RoomJourneyCue {
  if (entryStage === 'MediaSetup') return intent === 'join' ? 'outside' : 'waiting';
  if (!active) return intent === 'join' ? 'outside' : 'connecting';
  return roomJourneyCue(intent, status);
}

const successfulAdmission = (previous: RoomJourneyCue, next: RoomJourneyCue) =>
  (previous === 'waiting' || previous === 'outside') &&
  (next === 'connecting' || next === 'together');

// `waiting -> connecting` also occurs while a host creates a room after the
// media setup button is pressed. Only an avatar that was actually outside
// should drive the physical door animation.
const successfulDoorAdmission = (previous: RoomJourneyCue, next: RoomJourneyCue) =>
  previous === 'outside' && (next === 'connecting' || next === 'together');

export function roomTransition(
  previous: RoomJourneyCue,
  next: RoomJourneyCue,
  reducedMotion: boolean,
): RoomTransition {
  if (!reducedMotion && successfulAdmission(previous, next)) {
    return { kind: 'enter', durationMs: 900 };
  }
  return { kind: 'none', durationMs: 0 };
}

export function resolveRoomTransition(
  active: RoomTransition,
  previous: RoomJourneyCue,
  next: RoomJourneyCue,
  reducedMotion: boolean,
): RoomTransition {
  const requested = roomTransition(previous, next, reducedMotion);
  if (requested.kind === 'enter') return requested;
  if (
    !reducedMotion &&
    active.kind === 'enter' &&
    previous === 'connecting' &&
    next === 'together'
  ) {
    return active;
  }
  return requested;
}

export function doorTransition(
  previous: RoomJourneyCue,
  next: RoomJourneyCue,
  reducedMotion: boolean,
): DoorTransition {
  return !reducedMotion && successfulDoorAdmission(previous, next)
    ? { kind: 'admit', durationMs: ADMISSION_DURATION_MS }
    : { kind: 'none', durationMs: 0 };
}

export function resolveDoorTransition(
  active: DoorTransition,
  previous: RoomJourneyCue,
  next: RoomJourneyCue,
  reducedMotion: boolean,
): DoorTransition {
  const requested = doorTransition(previous, next, reducedMotion);
  if (requested.kind === 'admit') return requested;
  if (
    !reducedMotion &&
    active.kind === 'admit' &&
    previous === 'connecting' &&
    next === 'together'
  ) {
    return active;
  }
  return requested;
}

const smoothstep = (value: number) => value * value * (3 - 2 * value);

export function doorTransitionOpenness(transition: DoorTransition, elapsedMs: number): number {
  if (transition.kind === 'none' || elapsedMs <= 0 || elapsedMs >= transition.durationMs) return 0;

  const progress = elapsedMs / transition.durationMs;
  if (progress < ADMISSION_OPEN_FRACTION) {
    return smoothstep(progress / ADMISSION_OPEN_FRACTION);
  }
  if (progress <= ADMISSION_CLOSE_FRACTION) return 1;
  return 1 - smoothstep((progress - ADMISSION_CLOSE_FRACTION) / (1 - ADMISSION_CLOSE_FRACTION));
}

export const roomJourneyLabel = (cue: RoomJourneyCue): string => {
  switch (cue) {
    case 'waiting':
      return 'Waiting for the other person';
    case 'outside':
      return 'Waiting outside';
    case 'connecting':
      return 'Connecting';
    case 'stalled':
      return 'Still connecting';
    case 'together':
      return 'The other person is here';
    case 'reconnecting':
      return 'Reconnecting';
    case 'departed':
      return 'The other person left';
    case 'ended':
      return 'Call ended';
  }
};

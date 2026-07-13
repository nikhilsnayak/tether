import type { PeerSessionView, RoomSession } from '@tether/client-runtime/modules/peer-session';

export type RoomJourneyCue =
  | 'waiting'
  | 'outside'
  | 'screen-connecting'
  | 'screen-stalled'
  | 'screen-live'
  | 'screen-reconnecting'
  | 'screen-departed'
  | 'screen-ended';

export type RoomTransition =
  | { readonly kind: 'none'; readonly durationMs: 0 }
  | { readonly kind: 'enter'; readonly durationMs: number };

export function roomJourneyCue(
  intent: RoomSession['intent'],
  status: PeerSessionView['status'],
  hasRemoteStream: boolean,
): RoomJourneyCue {
  switch (status) {
    case 'disconnected':
    case 'failed':
    case 'room-full':
    case 'server-at-capacity':
    case 'peer-already-joined':
    case 'room-not-found':
    case 'join-denied':
      return 'screen-ended';
    case 'awaiting-approval':
      return 'outside';
    case 'peer-departed':
      return intent === 'join' ? 'screen-departed' : 'waiting';
    case 'waiting-for-peer':
      return 'waiting';
    case 'reconnecting':
    case 'transport-lost':
      return 'screen-reconnecting';
    case 'negotiation-stalled':
      return 'screen-stalled';
    case 'connecting':
      return 'screen-connecting';
    case 'connected':
      return hasRemoteStream ? 'screen-live' : 'screen-connecting';
  }
}

export function roomTransition(
  previous: RoomJourneyCue,
  next: RoomJourneyCue,
  reducedMotion: boolean,
): RoomTransition {
  if (previous === next) return { kind: 'none', durationMs: 0 };
  if (previous === 'outside' && next === 'screen-connecting') {
    return reducedMotion ? { kind: 'none', durationMs: 0 } : { kind: 'enter', durationMs: 900 };
  }
  return { kind: 'none', durationMs: 0 };
}

export const roomJourneyLabel = (cue: RoomJourneyCue): string => {
  switch (cue) {
    case 'waiting':
      return 'Waiting for the other person';
    case 'outside':
      return 'Waiting for the host';
    case 'screen-connecting':
      return 'Connecting';
    case 'screen-stalled':
      return 'Still connecting';
    case 'screen-live':
      return 'Remote video';
    case 'screen-reconnecting':
      return 'Reconnecting';
    case 'screen-departed':
      return 'The other person left';
    case 'screen-ended':
      return 'Call ended';
  }
};

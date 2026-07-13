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
  if (
    status === 'disconnected' ||
    status === 'failed' ||
    status === 'room-full' ||
    status === 'server-at-capacity' ||
    status === 'peer-already-joined' ||
    status === 'room-not-found' ||
    status === 'join-denied'
  ) {
    return 'screen-ended';
  }
  if (status === 'awaiting-approval') return 'outside';
  if (status === 'peer-departed') return intent === 'join' ? 'screen-departed' : 'waiting';
  if (status === 'waiting-for-peer') return 'waiting';
  if (status === 'reconnecting' || status === 'transport-lost') return 'screen-reconnecting';
  if (status === 'connected' && hasRemoteStream) return 'screen-live';
  if (status === 'negotiation-stalled') return 'screen-stalled';
  if (status === 'connecting' || status === 'connected') {
    return 'screen-connecting';
  }
  return intent === 'join' ? 'outside' : 'waiting';
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

export function nextUnannouncedPeerId<T extends string>(
  requests: ReadonlyArray<{ readonly peerId: T }>,
  announcedPeerIds: ReadonlySet<T>,
): T | null {
  return requests.find(({ peerId }) => !announcedPeerIds.has(peerId))?.peerId ?? null;
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

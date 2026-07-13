import type { PeerSessionView, RoomSession } from '@tether/client-runtime/modules/peer-session';

export type RoomJourneyCue =
  | 'waiting'
  | 'outside'
  | 'screen-connecting'
  | 'screen-live'
  | 'screen-reconnecting'
  | 'screen-ended';

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
  if (status === 'waiting-for-peer') return 'waiting';
  if (status === 'reconnecting' || status === 'transport-lost') return 'screen-reconnecting';
  if (status === 'connected' && hasRemoteStream) return 'screen-live';
  if (status === 'negotiation-stalled' || status === 'connecting' || status === 'connected') {
    return 'screen-connecting';
  }
  return intent === 'join' ? 'outside' : 'waiting';
}

export const roomJourneyLabel = (cue: RoomJourneyCue): string => {
  switch (cue) {
    case 'waiting':
      return 'Waiting for the other person';
    case 'outside':
      return 'Waiting for the host';
    case 'screen-connecting':
      return 'Connecting';
    case 'screen-live':
      return 'Remote video';
    case 'screen-reconnecting':
      return 'Reconnecting';
    case 'screen-ended':
      return 'Call ended';
  }
};

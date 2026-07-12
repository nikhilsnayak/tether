import type { PeerSessionView } from '../peer-session/Model';

const ERROR_STATUSES = new Set<PeerSessionView['status']>([
  'room-full',
  'server-at-capacity',
  'peer-already-joined',
  'room-not-found',
  'join-denied',
  'disconnected',
  'failed',
]);

export const isPeerSessionErrorStatus = (status: PeerSessionView['status']) =>
  ERROR_STATUSES.has(status);

export type PeerSessionStatusTone = 'success' | 'warning' | 'destructive' | 'muted';

export interface PeerSessionStatusPresentation {
  readonly tone: PeerSessionStatusTone;
  readonly pulse: boolean;
  readonly label: string;
  readonly hint: string;
}

export function peerSessionStatusPresentation(
  status: PeerSessionView['status'],
): PeerSessionStatusPresentation {
  switch (status) {
    case 'connecting':
      return {
        tone: 'warning',
        pulse: true,
        label: 'Connecting',
        hint: 'Establishing a secure connection…',
      };
    case 'connected':
      return {
        tone: 'success',
        pulse: false,
        label: 'Connected',
        hint: 'You are connected.',
      };
    case 'reconnecting':
      return {
        tone: 'warning',
        pulse: true,
        label: 'Reconnecting',
        hint: 'Connection interrupted. Trying to recover…',
      };
    case 'transport-lost':
      return {
        tone: 'warning',
        pulse: false,
        label: 'Connection dropped',
        hint: 'Trying to get you reconnected. You can also leave and retry.',
      };
    case 'waiting-for-peer':
      return {
        tone: 'warning',
        pulse: true,
        label: 'Waiting for the other person',
        hint: 'Share this room to invite someone.',
      };
    case 'awaiting-approval':
      return {
        tone: 'warning',
        pulse: true,
        label: 'Waiting for the host',
        hint: 'The host needs to let you in before the call starts.',
      };
    case 'negotiation-stalled':
      return {
        tone: 'warning',
        pulse: false,
        label: 'Taking longer than expected',
        hint: 'Still connecting. You can leave and retry.',
      };
    case 'disconnected':
      return {
        tone: 'muted',
        pulse: false,
        label: 'Connection lost',
        hint: 'Lost contact with the room. Leave and rejoin to retry.',
      };
    case 'failed':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Session failed',
        hint: 'Something went wrong with the connection.',
      };
    case 'room-full':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Room is full',
        hint: 'This room already has two people.',
      };
    case 'server-at-capacity':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Service is busy',
        hint: 'Tether has reached its current call capacity. Try again shortly.',
      };
    case 'peer-already-joined':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Already joined',
        hint: 'You already have this room open somewhere else, maybe in another tab or on another device.',
      };
    case 'room-not-found':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Room not found',
        hint: 'This room does not exist or has already ended.',
      };
    case 'join-denied':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Request declined',
        hint: 'The host declined your request to join.',
      };
  }
}

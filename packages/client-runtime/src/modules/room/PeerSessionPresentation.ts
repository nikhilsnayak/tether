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
  readonly direct: boolean;
}

export function peerSessionStatusPresentation(
  status: PeerSessionView['status'],
  detached: boolean,
): PeerSessionStatusPresentation {
  const direct = status === 'connected' && detached;
  switch (status) {
    case 'connecting':
      return {
        tone: 'warning',
        pulse: true,
        label: 'Connecting',
        hint: 'Establishing a secure connection…',
        direct,
      };
    case 'connected':
      return {
        tone: 'success',
        pulse: false,
        label: 'Connected',
        hint: detached
          ? 'Direct connection. The call no longer uses the Tether server.'
          : 'You are connected.',
        direct,
      };
    case 'reconnecting':
      return {
        tone: 'warning',
        pulse: true,
        label: 'Reconnecting',
        hint: 'Connection interrupted. Trying to recover…',
        direct,
      };
    case 'transport-lost':
      return {
        tone: 'warning',
        pulse: false,
        label: detached ? 'Connection lost' : 'Connection dropped',
        hint: detached
          ? 'The direct connection failed. Create a new room to reconnect.'
          : 'Trying to get you reconnected. You can also leave and retry.',
        direct,
      };
    case 'waiting-for-peer':
      return {
        tone: 'warning',
        pulse: true,
        label: 'Waiting for the other person',
        hint: 'Share this room to invite someone.',
        direct,
      };
    case 'peer-departed':
      return {
        tone: 'warning',
        pulse: !detached,
        label: detached ? 'They left the call' : 'Waiting for the other person',
        hint: detached
          ? 'This room has ended. Create a new room to talk again.'
          : 'They left the call. You can wait here in case they rejoin.',
        direct,
      };
    case 'awaiting-approval':
      return {
        tone: 'warning',
        pulse: true,
        label: 'Waiting for the host',
        hint: 'The host needs to let you in before the call starts.',
        direct,
      };
    case 'negotiation-stalled':
      return {
        tone: 'warning',
        pulse: false,
        label: 'Taking longer than expected',
        hint: 'Still connecting. You can leave and retry.',
        direct,
      };
    case 'disconnected':
      return {
        tone: 'muted',
        pulse: false,
        label: 'Connection lost',
        hint: 'Lost contact with the room. Leave and rejoin to retry.',
        direct,
      };
    case 'failed':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Session failed',
        hint: 'Something went wrong with the connection.',
        direct,
      };
    case 'room-full':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Room is full',
        hint: 'This room already has two people.',
        direct,
      };
    case 'server-at-capacity':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Service is busy',
        hint: 'Tether has reached its current call capacity. Try again shortly.',
        direct,
      };
    case 'peer-already-joined':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Already joined',
        hint: 'You already have this room open somewhere else, maybe in another tab or on another device.',
        direct,
      };
    case 'room-not-found':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Room not found',
        hint: 'This room does not exist or has already ended.',
        direct,
      };
    case 'join-denied':
      return {
        tone: 'destructive',
        pulse: false,
        label: 'Request declined',
        hint: 'The host declined your request to join.',
        direct,
      };
  }
}

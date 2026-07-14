import type { RoomId } from '@tether/contracts/modules/room';

import type { ChatMessage, PeerSessionEvent, PeerSessionView } from './Model';

export const initialPeerSessionView: PeerSessionView = {
  status: 'connecting',
  messages: [],
  roomEventsReady: false,
  remoteAvatarPose: null,
  remoteMediaState: null,
  sas: null,
  roomId: null,
  roomTemplateId: null,
  pendingJoinRequests: [],
};

export const reducePeerSessionView = (
  view: PeerSessionView,
  event: PeerSessionEvent,
): PeerSessionView => {
  switch (event._tag) {
    case 'SessionStarted':
      return initialPeerSessionView;
    case 'LocalStreamReady':
    case 'RemoteStreamReady':
      // Live media handles are projected into dedicated atoms by the platform
      // UI layer; they are not part of the serializable view.
      return view;
    case 'WaitingForPeer':
      return { ...view, status: 'waiting-for-peer' };
    case 'Connected':
      return { ...view, status: 'connected' };
    case 'RoomEventsReady':
      return { ...view, roomEventsReady: true };
    case 'RoomEventsUnavailable':
      return { ...view, roomEventsReady: false };
    case 'RemoteAvatarPoseChanged':
      return { ...view, remoteAvatarPose: event.pose };
    case 'RemoteMediaStateChanged':
      return { ...view, remoteMediaState: event.mediaState };
    case 'ChatMessageAdded':
      return { ...view, messages: [...view.messages, event.message] };
    case 'SasReady':
      return { ...view, sas: event.code };
    case 'SignalingDisconnected':
      return {
        ...view,
        status: 'disconnected',
        roomEventsReady: false,
        remoteAvatarPose: null,
        remoteMediaState: null,
      };
    case 'SessionFailed':
      return {
        ...view,
        status: 'failed',
        roomEventsReady: false,
        remoteAvatarPose: null,
        remoteMediaState: null,
      };
    case 'TransportLost':
      return {
        ...view,
        status: 'transport-lost',
        roomEventsReady: false,
        remoteAvatarPose: null,
        remoteMediaState: null,
        sas: null,
      };
    case 'NegotiationStalled':
      return { ...view, status: 'negotiation-stalled' };
    // Hide verification while transport is interrupted. A replacement
    // connection mints fresh certificates; a transient recovery re-emits it.
    case 'PeerInterrupted':
      return {
        ...view,
        status: 'reconnecting',
        roomEventsReady: false,
        sas: null,
      };
    case 'PeerRestored':
      return { ...view, status: 'connected' };
    case 'RoomOpened':
      return {
        ...view,
        roomId: event.roomId,
        roomTemplateId: event.roomTemplateId,
      };
    case 'RoomJoinRejected':
      return {
        ...view,
        status: event.reason,
        roomEventsReady: false,
        remoteAvatarPose: null,
        remoteMediaState: null,
      };
    case 'JoinRequestReceived':
      return view.pendingJoinRequests.some((request) => request.peerId === event.peerId)
        ? view
        : {
            ...view,
            pendingJoinRequests: [
              ...view.pendingJoinRequests,
              { peerId: event.peerId, displayName: event.displayName },
            ],
          };
    case 'JoinPending':
      return { ...view, status: 'awaiting-approval' };
    case 'JoinRequestCancelled':
    case 'JoinRequestHandled': {
      const pendingJoinRequests = view.pendingJoinRequests.filter(
        (request) => request.peerId !== event.peerId,
      );
      return pendingJoinRequests.length === view.pendingJoinRequests.length
        ? view
        : { ...view, pendingJoinRequests };
    }
    case 'PeerDeparted':
      return {
        ...view,
        status: 'peer-departed',
        roomEventsReady: false,
        remoteAvatarPose: null,
        remoteMediaState: null,
        sas: null,
      };
  }
};

export type { ChatMessage, PeerSessionView, RoomId };

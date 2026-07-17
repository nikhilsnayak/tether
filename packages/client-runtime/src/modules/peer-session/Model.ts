import type { DisplayName, PeerId, RoomId, RoomTemplateId } from '@tether/contracts/modules/room';

import type { RevisionedMediaState, SequencedAvatarPose } from './RoomEvents';

export interface IceServer {
  readonly urls: ReadonlyArray<string>;
}

// Mirrors OpenRoomSessionPayload: a host mints its room server-side and sends
// no roomId; a joiner names the room and itself. The minted id arrives in
// RoomSessionOpenedEvent, so downstream RPCs read roomId from that, not here.
export type RoomSession =
  | {
      readonly intent: 'host';
      readonly selfId: PeerId;
      readonly roomTemplateId: RoomTemplateId;
    }
  | {
      readonly intent: 'join';
      readonly selfId: PeerId;
      readonly roomId: RoomId;
      readonly displayName: DisplayName;
    };

export interface SessionDescription {
  readonly type: 'offer' | 'answer';
  readonly sdp?: string;
}

/** Platform candidate data before the actor adds its signaling envelope. */
export interface IceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  readonly usernameFragment: string | null;
}

export type PeerSessionSignal =
  | {
      readonly _tag: 'SessionDescription';
      readonly type: 'offer' | 'answer';
      readonly sdp: string;
      readonly negotiationEpoch: number;
    }
  | ({ readonly _tag: 'IceCandidate'; readonly negotiationEpoch: number } & IceCandidate);

export interface PeerConnectionHandle {
  readonly value: unknown;
}

export interface DataChannelHandle {
  readonly value: unknown;
}

export interface MediaStreamHandle {
  readonly value: unknown;
}

export interface SharedTransceiverHandle {
  readonly value: unknown;
}

export type PlatformEvent =
  | {
      readonly _tag: 'RemoteDataChannel';
      readonly peerConnection: PeerConnectionHandle;
      readonly dataChannel: DataChannelHandle;
    }
  | {
      readonly _tag: 'LocalIceCandidate';
      readonly peerConnection: PeerConnectionHandle;
      readonly candidate: IceCandidate;
    }
  | {
      readonly _tag: 'DataChannelOpened';
      readonly dataChannel: DataChannelHandle;
    }
  | {
      readonly _tag: 'DataChannelMessageReceived';
      readonly dataChannel: DataChannelHandle;
      readonly data: unknown;
    }
  | { readonly _tag: 'PeerConnectionFailed'; readonly peerConnection: PeerConnectionHandle }
  | { readonly _tag: 'PeerConnectionConnected'; readonly peerConnection: PeerConnectionHandle }
  | { readonly _tag: 'IceGatheringComplete'; readonly peerConnection: PeerConnectionHandle }
  | { readonly _tag: 'DataChannelClosed'; readonly dataChannel: DataChannelHandle }
  | { readonly _tag: 'PeerConnectionInterrupted'; readonly peerConnection: PeerConnectionHandle }
  | { readonly _tag: 'PeerConnectionRestored'; readonly peerConnection: PeerConnectionHandle }
  | {
      readonly _tag: 'RemoteTrackReceived';
      readonly peerConnection: PeerConnectionHandle;
      readonly stream: MediaStreamHandle;
    }
  | {
      readonly _tag: 'RemoteSharedTrackReceived';
      readonly peerConnection: PeerConnectionHandle;
      readonly stream: MediaStreamHandle;
    };

/**
 * Synchronous callback bridge for native event listeners. Dispatch only queues
 * the event; the actor processes it later in its serialized stream.
 */
export type PlatformEventDispatch = (event: PlatformEvent) => void;

export interface ChatMessage {
  readonly id: string;
  readonly sender: 'self' | 'peer';
  readonly text: string;
}

export type PeerSessionEvent =
  | {
      readonly _tag: 'SessionStarted';
    }
  | {
      readonly _tag: 'LocalStreamReady';
      readonly stream: MediaStreamHandle;
    }
  | {
      readonly _tag: 'RemoteStreamReady';
      readonly stream: MediaStreamHandle;
    }
  | {
      readonly _tag: 'WaitingForPeer';
    }
  | {
      readonly _tag: 'Connected';
      readonly peerId: PeerId;
    }
  | { readonly _tag: 'RoomEventsReady' }
  | { readonly _tag: 'RoomEventsUnavailable' }
  | {
      readonly _tag: 'RemoteAvatarPoseChanged';
      readonly pose: SequencedAvatarPose;
    }
  | {
      readonly _tag: 'RemoteMediaStateChanged';
      readonly mediaState: RevisionedMediaState;
    }
  | {
      readonly _tag: 'ChatMessageAdded';
      readonly message: ChatMessage;
    }
  | {
      readonly _tag: 'SasReady';
      readonly code: string;
    }
  | {
      readonly _tag: 'SignalingDisconnected';
    }
  | { readonly _tag: 'SessionDetached' }
  | {
      readonly _tag: 'SessionFailed';
    }
  | {
      readonly _tag: 'TransportLost';
      readonly peerId: PeerId;
    }
  | {
      readonly _tag: 'NegotiationStalled';
      readonly peerId: PeerId;
    }
  | {
      readonly _tag: 'PeerInterrupted';
      readonly peerId: PeerId;
    }
  | {
      readonly _tag: 'PeerRestored';
      readonly peerId: PeerId;
    }
  // Carries the server-minted roomId to the UI. A host learns its room this
  // way; a joiner already knew it but receives the same event.
  | {
      readonly _tag: 'RoomOpened';
      readonly roomId: RoomId;
      readonly roomTemplateId: RoomTemplateId;
    }
  | {
      readonly _tag: 'RoomJoinRejected';
      readonly reason:
        | 'room-full'
        | 'server-at-capacity'
        | 'peer-already-joined'
        | 'room-not-found'
        | 'join-denied';
    }
  // Host side: a joiner is knocking and awaits an allow/deny decision. The name
  // is an unauthenticated claim the joiner typed.
  | {
      readonly _tag: 'JoinRequestReceived';
      readonly peerId: PeerId;
      readonly displayName: DisplayName;
    }
  // Joiner side: the knock reached the host; waiting on the decision.
  | {
      readonly _tag: 'JoinPending';
    }
  // Host side: a pending knock was withdrawn (joiner left or timed out).
  | {
      readonly _tag: 'JoinRequestCancelled';
      readonly peerId: PeerId;
    }
  | {
      readonly _tag: 'JoinRequestHandled';
      readonly peerId: PeerId;
    }
  | {
      readonly _tag: 'PeerDeparted';
      readonly peerId: PeerId;
    };

/** A joiner's knock awaiting the host's decision. The name is an unverified claim. */
export interface JoinRequestClaim {
  readonly peerId: PeerId;
  readonly displayName: DisplayName;
}

export interface PeerSessionView {
  readonly status:
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected'
    | 'failed'
    | 'transport-lost'
    | 'negotiation-stalled'
    | 'room-full'
    | 'server-at-capacity'
    | 'peer-already-joined'
    | 'room-not-found'
    | 'join-denied'
    | 'awaiting-approval'
    | 'waiting-for-peer'
    | 'peer-departed';
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly roomEventsReady: boolean;
  readonly detached: boolean;
  readonly remoteAvatarPose: SequencedAvatarPose | null;
  readonly remoteMediaState: RevisionedMediaState | null;
  /** Safety code both peers compare aloud. */
  readonly sas: string | null;
  /** The server-minted room, known once the session opens. */
  readonly roomId: RoomId | null;
  /** The client-side scene selected by the host. */
  readonly roomTemplateId: RoomTemplateId | null;
  /** Host side: ordered knocks that have not yet been handled or withdrawn. */
  readonly pendingJoinRequests: ReadonlyArray<JoinRequestClaim>;
}

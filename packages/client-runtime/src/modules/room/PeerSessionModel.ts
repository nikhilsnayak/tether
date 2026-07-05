import type { IceCandidateSignal, PeerId, RoomId } from '@tether/contracts/modules/room';
import { Data, Predicate } from 'effect';

export const CHAT_CHANNEL_LABEL = 'chat';

export interface IceServer {
  readonly urls: ReadonlyArray<string>;
}

export const GOOGLE_STUN_SERVERS: ReadonlyArray<IceServer> = [
  { urls: ['stun:stun.l.google.com:19302'] },
];

export type PlatformOperation =
  | 'acquire-peer-connection'
  | 'acquire-local-media'
  | 'add-local-tracks'
  | 'create-data-channel'
  | 'create-offer'
  | 'create-answer'
  | 'set-local-description'
  | 'set-remote-description'
  | 'add-ice-candidate'
  | 'send-message';

/** Identifies the failed WebRTC step without inspecting its untyped cause. */
export class PlatformError extends Data.TaggedError('PlatformError')<{
  readonly operation: PlatformOperation;
  readonly cause: unknown;
}> {}

export const isPlatformError = (u: unknown): u is PlatformError =>
  Predicate.isTagged(u, 'PlatformError');

export interface RoomSession {
  readonly roomId: RoomId;
  readonly selfId: PeerId;
}

export interface SessionDescription {
  readonly type: 'offer' | 'answer';
  readonly sdp?: string;
}

export interface PeerConnectionHandle {
  readonly value: unknown;
}

export interface DataChannelHandle {
  readonly value: unknown;
}

export interface MediaStreamHandle {
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
      readonly candidate: IceCandidateSignal;
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
  | { readonly _tag: 'DataChannelClosed'; readonly dataChannel: DataChannelHandle }
  | { readonly _tag: 'PeerConnectionInterrupted'; readonly peerConnection: PeerConnectionHandle }
  | { readonly _tag: 'PeerConnectionRestored'; readonly peerConnection: PeerConnectionHandle }
  | {
      readonly _tag: 'RemoteTrackReceived';
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
  | { readonly _tag: 'ChatReady' }
  | { readonly _tag: 'ChatUnavailable' }
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
  | {
      readonly _tag: 'RoomJoinRejected';
      readonly reason: 'room-full' | 'server-at-capacity' | 'peer-already-joined';
    }
  | {
      readonly _tag: 'PeerDeparted';
      readonly peerId: PeerId;
    };

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
    | 'waiting-for-peer';
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly chatReady: boolean;
  /** Safety code both peers compare aloud. */
  readonly sas: string | null;
}

export const initialPeerSessionView: PeerSessionView = {
  status: 'connecting',
  messages: [],
  chatReady: false,
  sas: null,
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
    case 'ChatReady':
      return { ...view, chatReady: true };
    case 'ChatUnavailable':
      return { ...view, chatReady: false };
    case 'ChatMessageAdded':
      return { ...view, messages: [...view.messages, event.message] };
    case 'SasReady':
      return { ...view, sas: event.code };
    case 'SignalingDisconnected':
      return { ...view, status: 'disconnected' };
    case 'SessionFailed':
      return { ...view, status: 'failed' };
    case 'TransportLost':
      return { ...view, status: 'transport-lost', chatReady: false, sas: null };
    case 'NegotiationStalled':
      return { ...view, status: 'negotiation-stalled' };
    // Hide verification while transport is interrupted. A replacement
    // connection mints fresh certificates; a transient recovery re-emits it.
    case 'PeerInterrupted':
      return { ...view, status: 'reconnecting', chatReady: false, sas: null };
    case 'PeerRestored':
      return { ...view, status: 'connected' };
    case 'RoomJoinRejected':
      return { ...view, status: event.reason };
    case 'PeerDeparted':
      return { ...view, status: 'waiting-for-peer', chatReady: false, sas: null };
  }
};

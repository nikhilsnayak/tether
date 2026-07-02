import type { IceCandidateSignal, PeerId, RoomId } from '@tether/contracts/modules/room';
import { Data, Predicate } from 'effect';

export const CHAT_CHANNEL_LABEL = 'chat';

/** Which WebRTC operation a {@link PlatformError} originated from. */
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

/**
 * Typed failure from a {@link PeerSessionPlatform} operation. Carrying the
 * originating `operation` lets the actor and session teardown branch on which
 * WebRTC step failed instead of inspecting an untyped `unknown`.
 */
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

/** Platform-owned peer connection hidden from the shared actor. */
export interface PeerConnectionHandle {
  readonly value: unknown;
}

/** Platform-owned data channel hidden from the shared actor. */
export interface DataChannelHandle {
  readonly value: unknown;
}

/** Platform-owned local media stream (camera + microphone) hidden from the actor. */
export interface MediaStreamHandle {
  readonly value: unknown;
}

/** Events observed by a native platform adapter and serialized through the actor. */
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

/** Domain output emitted by the actor without assuming a UI state library. */
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
      readonly _tag: 'Connected';
      readonly peerId: PeerId;
    }
  | {
      readonly _tag: 'ChatMessageAdded';
      readonly message: ChatMessage;
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
      readonly reason: 'room-full' | 'peer-already-joined';
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
    | 'peer-already-joined'
    | 'waiting-for-peer';
  readonly messages: ReadonlyArray<ChatMessage>;
}

export const initialPeerSessionView: PeerSessionView = {
  status: 'connecting',
  messages: [],
};

/** Projects platform-independent actor events into renderable session state. */
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
    case 'Connected':
      return { ...view, status: 'connected' };
    case 'ChatMessageAdded':
      return { ...view, messages: [...view.messages, event.message] };
    case 'SignalingDisconnected':
      return { ...view, status: 'disconnected' };
    case 'SessionFailed':
      return { ...view, status: 'failed' };
    case 'TransportLost':
      return { ...view, status: 'transport-lost' };
    case 'NegotiationStalled':
      return { ...view, status: 'negotiation-stalled' };
    case 'PeerInterrupted':
      return { ...view, status: 'reconnecting' };
    case 'PeerRestored':
      return { ...view, status: 'connected' };
    case 'RoomJoinRejected':
      return { ...view, status: event.reason };
    case 'PeerDeparted':
      return { ...view, status: 'waiting-for-peer' };
  }
};

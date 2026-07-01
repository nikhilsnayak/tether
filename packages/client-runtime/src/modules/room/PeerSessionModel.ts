import type { IceCandidateSignal, PeerId, RoomId } from '@tether/contracts/modules/room';

export const CHAT_CHANNEL_LABEL = 'chat';

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
  | { readonly _tag: 'DataChannelClosed'; readonly dataChannel: DataChannelHandle };

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
    | 'disconnected'
    | 'failed'
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
    case 'Connected':
      return { ...view, status: 'connected' };
    case 'ChatMessageAdded':
      return { ...view, messages: [...view.messages, event.message] };
    case 'SignalingDisconnected':
      return { ...view, status: 'disconnected' };
    case 'SessionFailed':
      return { ...view, status: 'failed' };
    case 'RoomJoinRejected':
      return { ...view, status: event.reason };
    case 'PeerDeparted':
      return { ...view, status: 'waiting-for-peer' };
  }
};

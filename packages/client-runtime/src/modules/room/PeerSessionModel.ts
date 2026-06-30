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

export type PeerRole = 'offerer' | 'answerer';

export type DataChannelState =
  | {
      readonly _tag: 'AwaitingRemoteDataChannel';
    }
  | {
      readonly _tag: 'DataChannelConnecting';
      readonly dataChannel: DataChannelHandle;
    }
  | {
      readonly _tag: 'DataChannelOpen';
      readonly dataChannel: DataChannelHandle;
    };

/**
 * Internal handshake state. A peer connection exists after the room opens;
 * peer identity, negotiation role, and data-channel ownership become available
 * only in the variants that can validly use them.
 */
export type PeerSessionActorState =
  | {
      readonly _tag: 'AwaitingRoomSession';
    }
  | {
      readonly _tag: 'WaitingForPeer';
      readonly peerConnection: PeerConnectionHandle;
    }
  | {
      readonly _tag: 'PeerKnown';
      readonly peerConnection: PeerConnectionHandle;
      readonly peerId: PeerId;
      readonly role: PeerRole;
      readonly dataChannelState: DataChannelState;
    };

/** Events raised by a native platform adapter and serialized through the actor. */
export type PlatformCommand =
  | {
      readonly _tag: 'RemoteDataChannel';
      readonly dataChannel: DataChannelHandle;
    }
  | {
      readonly _tag: 'LocalIceCandidate';
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
    };

/**
 * Synchronous callback bridge for native event listeners. Dispatch only queues
 * the command; the actor processes it later in its serialized stream.
 */
export type PlatformCommandDispatch = (command: PlatformCommand) => void;

export interface ChatMessage {
  readonly id: string;
  readonly sender: 'self' | 'peer';
  readonly text: string;
}

/** Domain output emitted by the actor without assuming a UI state library. */
export type PeerSessionEvent =
  | {
      readonly _tag: 'Connected';
      readonly peerId: PeerId;
    }
  | {
      readonly _tag: 'ChatMessageAdded';
      readonly message: ChatMessage;
    };

export interface PeerSessionView {
  readonly status: 'connecting' | 'connected';
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
    case 'Connected':
      return { ...view, status: 'connected' };
    case 'ChatMessageAdded':
      return { ...view, messages: [...view.messages, event.message] };
  }
};

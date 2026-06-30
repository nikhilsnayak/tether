import type { PeerId, RoomEvent } from '@tether/contracts/modules/room';

export const CHAT_CHANNEL_LABEL = 'chat';

export type PeerRole = 'offerer' | 'answerer';

export type DataChannelState =
  | {
      readonly _tag: 'AwaitingRemoteDataChannel';
    }
  | {
      readonly _tag: 'DataChannelConnecting';
      readonly dataChannel: RTCDataChannel;
    }
  | {
      readonly _tag: 'DataChannelOpen';
      readonly dataChannel: RTCDataChannel;
    };

export type PeerConnectionActorState =
  | {
      readonly _tag: 'AwaitingRoomSession';
    }
  | {
      readonly _tag: 'WaitingForPeer';
      readonly peerConnection: RTCPeerConnection;
    }
  | {
      readonly _tag: 'PeerKnown';
      readonly peerConnection: RTCPeerConnection;
      readonly peerId: PeerId;
      readonly role: PeerRole;
      readonly dataChannelState: DataChannelState;
    };

export type BrowserCommand =
  | {
      readonly _tag: 'RemoteDataChannel';
      readonly dataChannel: RTCDataChannel;
    }
  | {
      readonly _tag: 'LocalIceCandidate';
      readonly candidate: RTCIceCandidateInit;
    }
  | {
      readonly _tag: 'DataChannelOpened';
      readonly dataChannel: RTCDataChannel;
    }
  | {
      readonly _tag: 'DataChannelMessageReceived';
      readonly dataChannel: RTCDataChannel;
      readonly data: unknown;
    };

export type UiCommand = {
  readonly _tag: 'SendMessage';
  readonly message: string;
};

export type PeerConnectionCommand =
  | {
      readonly _tag: 'RoomEvent';
      readonly event: RoomEvent;
    }
  | BrowserCommand
  | UiCommand;

export interface ChatMessage {
  readonly id: string;
  readonly sender: 'self' | 'peer';
  readonly text: string;
}

export interface PeerSessionView {
  readonly status: 'connecting' | 'connected';
  readonly messages: ReadonlyArray<ChatMessage>;
}

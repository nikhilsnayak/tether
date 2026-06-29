/**
 * Domain state and serialized commands for the peer-session subsystem.
 */

import type { PeerId, RoomEvent } from '@tether/contracts/modules/room';

/** The single in-band data channel negotiated by the offerer. */
export const CHAT_CHANNEL_LABEL = 'chat';

/** Whether this peer creates the initial offer or answers it. */
export type PeerRole = 'offerer' | 'answerer';

/** The state of the single in-band data channel. */
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

/** Actor-owned state for the lifetime of one room session. */
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

/** Commands emitted synchronously by browser WebRTC callbacks. */
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

/** Commands emitted by the UI layer. */
export type UiCommand = {
  readonly _tag: 'SendMessage';
  readonly message: string;
};

/** The complete serialized input understood by the peer-session actor. */
export type PeerConnectionCommand =
  | {
      readonly _tag: 'RoomEvent';
      readonly event: RoomEvent;
    }
  | BrowserCommand
  | UiCommand;

/** The UI representation of a chat message. */
export interface ChatMessage {
  readonly id: string;
  readonly sender: 'self' | 'peer';
  readonly text: string;
}

/** The UI representation of the peer-session state. */
export interface PeerSessionView {
  readonly status: 'connecting' | 'connected';
  readonly messages: ReadonlyArray<ChatMessage>;
}

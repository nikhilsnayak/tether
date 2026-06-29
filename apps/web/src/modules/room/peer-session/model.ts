/**
 * Domain state and serialized commands for the peer-session subsystem.
 * These types contain no transport or React lifecycle behavior.
 */

import type { PeerId, RoomEvent } from '@tether/contracts/modules/room';

/** The single in-band data channel negotiated by the offerer. */
export const CHAT_CHANNEL_LABEL = 'chat';

/** Whether this peer creates the initial offer or answers it. */
export type PeerRole = 'offerer' | 'answerer';

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
      readonly dataChannel: RTCDataChannel | null;
      readonly dataChannelStatus: 'connecting' | 'open';
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

/** The complete serialized input understood by the peer-session actor. */
export type PeerConnectionCommand =
  | {
      readonly _tag: 'RoomEvent';
      readonly event: RoomEvent;
    }
  | BrowserCommand;

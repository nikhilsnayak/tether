import type { PeerId, RoomEvent } from '@tether/contracts/modules/room';
import type { Scope } from 'effect';

import type { DataChannelHandle, PeerConnectionHandle, PlatformEvent } from './PeerSessionModel';

export type PeerRole = 'offerer' | 'answerer';

export type DataChannelState =
  | { readonly _tag: 'AwaitingRemoteDataChannel' }
  | { readonly _tag: 'DataChannelConnecting'; readonly dataChannel: DataChannelHandle }
  | { readonly _tag: 'DataChannelOpen'; readonly dataChannel: DataChannelHandle }
  | { readonly _tag: 'DataChannelClosed'; readonly dataChannel: DataChannelHandle };

export type PeerConnectionGeneration = {
  readonly scope: Scope.Closeable;
  readonly peerConnection: PeerConnectionHandle;
};

export type PeerSessionActorState =
  | { readonly _tag: 'AwaitingRoomSession' }
  | { readonly _tag: 'WaitingForPeer'; readonly generation: PeerConnectionGeneration }
  | {
      readonly _tag: 'PeerKnown';
      readonly generation: PeerConnectionGeneration;
      readonly peerId: PeerId;
      readonly role: PeerRole;
      readonly peerConnectionState: 'connecting' | 'connected' | 'interrupted';
      readonly dataChannelState: DataChannelState;
      readonly negotiationEpoch: number | null;
      readonly reconnectAttempts: number;
      /** Handshake descriptions retained until the peer connection succeeds. */
      readonly offerSdp: string | null;
      readonly answerSdp: string | null;
    }
  | { readonly _tag: 'TransportLost'; readonly peerId: PeerId };

export type PeerSessionUiCommand = {
  readonly _tag: 'SendMessage';
  readonly message: string;
};

/** Identifies the connection generation guarded by a negotiation deadline. */
export type PeerSessionTimerInput = {
  readonly _tag: 'NegotiationDeadlineElapsed';
  readonly peerConnection: PeerConnectionHandle;
};

export type PeerSessionLocalInput = PlatformEvent | PeerSessionUiCommand | PeerSessionTimerInput;

export type PeerSessionLocalInputDispatch = (input: PeerSessionLocalInput) => void;

export type PeerSessionInput =
  | { readonly _tag: 'RoomEvent'; readonly event: RoomEvent }
  | PeerSessionLocalInput;

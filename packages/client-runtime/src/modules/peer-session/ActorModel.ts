import type { PeerId, RoomTemplateId } from '@tether/contracts/modules/room';
import type { Scope } from 'effect';

import type {
  DataChannelHandle,
  MediaStreamHandle,
  PeerConnectionHandle,
  PeerSessionSignal,
  PlatformEvent,
  ProgramTransceiverHandle,
} from './Model';
import type { AvatarPose, MediaState } from './RoomEvents';

export type DataChannelState =
  | { readonly _tag: 'AwaitingRemoteDataChannel' }
  | { readonly _tag: 'DataChannelConnecting'; readonly dataChannel: DataChannelHandle }
  | { readonly _tag: 'DataChannelOpen'; readonly dataChannel: DataChannelHandle }
  | { readonly _tag: 'DataChannelClosed'; readonly dataChannel: DataChannelHandle };

export type PeerConnectionGeneration = {
  readonly scope: Scope.Closeable;
  readonly peerConnection: PeerConnectionHandle;
  /** Present only when the room template enables watch-along. */
  readonly programTransceivers: ProgramTransceiverHandle | null;
};

export type PeerNegotiationState =
  | {
      readonly role: 'offerer';
      readonly phase: 'awaiting-answer';
      readonly epoch: number;
      readonly offerSdp: string;
    }
  | {
      readonly role: 'offerer';
      readonly phase: 'answered';
      readonly epoch: number;
      readonly offerSdp: string;
      readonly answerSdp: string;
    }
  | { readonly role: 'answerer'; readonly phase: 'awaiting-offer' }
  | {
      readonly role: 'answerer';
      readonly phase: 'answered';
      readonly epoch: number;
      readonly offerSdp: string;
      readonly answerSdp: string;
    };

export type PeerSessionActorState =
  | { readonly _tag: 'AwaitingRoomSession' }
  | { readonly _tag: 'WaitingForPeer'; readonly generation: PeerConnectionGeneration }
  | {
      readonly _tag: 'PeerKnown';
      readonly generation: PeerConnectionGeneration;
      readonly peerId: PeerId;
      readonly negotiation: PeerNegotiationState;
      readonly peerConnectionState: 'connecting' | 'connected' | 'interrupted';
      readonly iceGatheringComplete: boolean;
      readonly dataChannelState: DataChannelState;
      /**
       * The watch-control channel handle once provisioned; open/close semantics
       * belong to the watch actor. Present only when watch-along is enabled.
       */
      readonly watchChannel: DataChannelHandle | null;
      /** Stream assembled from the generation's reserved remote transceivers. */
      readonly remoteSharedStream: MediaStreamHandle | null;
      readonly reconnectAttempts: number;
    }
  | { readonly _tag: 'TransportLost'; readonly peerId: PeerId };

export type PeerSessionUiCommand =
  | {
      readonly _tag: 'SendMessage';
      readonly message: string;
    }
  | { readonly _tag: 'SendAvatarPose'; readonly pose: AvatarPose }
  | { readonly _tag: 'SendMediaState'; readonly mediaState: MediaState }
  | { readonly _tag: 'SendLeave' };

/** Identifies the connection generation guarded by a negotiation deadline. */
export type PeerSessionTimerInput =
  | {
      readonly _tag: 'NegotiationDeadlineElapsed';
      readonly peerConnection: PeerConnectionHandle;
    }
  | {
      readonly _tag: 'RetryPendingAvatarPose';
      readonly peerConnection: PeerConnectionHandle;
      readonly dataChannel: DataChannelHandle;
    };

export type PeerSessionLocalInput = PlatformEvent | PeerSessionUiCommand | PeerSessionTimerInput;

export type PeerSessionLocalInputDispatch = (input: PeerSessionLocalInput) => void;

export type PeerSessionRemoteInput =
  | {
      readonly _tag: 'RoomSessionOpened';
      readonly peerId: PeerId | null;
      readonly roomTemplateId: RoomTemplateId;
    }
  | { readonly _tag: 'PeerJoined'; readonly peerId: PeerId }
  | { readonly _tag: 'PeerLeft'; readonly peerId: PeerId }
  | { readonly _tag: 'Detached' }
  | {
      readonly _tag: 'SignalReceived';
      readonly peerId: PeerId;
      readonly signal: PeerSessionSignal;
    };

/** Enqueued by the signaling pump as its final act; the actor decides what it means. */
export type PeerSessionSignalingEnded = { readonly _tag: 'SignalingEnded' };

export type PeerSessionInput =
  | PeerSessionRemoteInput
  | PeerSessionLocalInput
  | PeerSessionSignalingEnded;

/** 'stop' ends the host drain loop; 'continue' keeps it running. */
export type PeerSessionInputOutcome = 'continue' | 'stop';

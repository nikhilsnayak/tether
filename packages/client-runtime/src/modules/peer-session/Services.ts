import { Context, Effect, type Scope } from 'effect';

import type {
  DataChannelHandle,
  IceCandidate,
  IceServer,
  MediaStreamHandle,
  PeerConnectionHandle,
  PeerSessionSignal,
  PeerSessionEvent,
  PlatformEventDispatch,
  SessionDescription,
} from './Model';
import type { PlatformError } from './Platform';

/** Platform-neutral WebRTC operations used by the peer-session actor. */
export class PeerSessionPlatform extends Context.Service<
  PeerSessionPlatform,
  {
    readonly acquirePeerConnection: (
      iceServers: ReadonlyArray<IceServer>,
    ) => Effect.Effect<PeerConnectionHandle, PlatformError, Scope.Scope>;
    readonly acquireLocalMedia: Effect.Effect<MediaStreamHandle, PlatformError, Scope.Scope>;
    readonly addLocalTracks: (
      peerConnection: PeerConnectionHandle,
      localStream: MediaStreamHandle,
    ) => Effect.Effect<void, PlatformError>;
    readonly observePeerConnection: (
      peerConnection: PeerConnectionHandle,
      dispatch: PlatformEventDispatch,
    ) => Effect.Effect<void, PlatformError, Scope.Scope>;
    readonly createDataChannel: (
      peerConnection: PeerConnectionHandle,
      label: string,
    ) => Effect.Effect<DataChannelHandle, PlatformError>;
    readonly observeDataChannel: (
      dataChannel: DataChannelHandle,
      dispatch: PlatformEventDispatch,
    ) => Effect.Effect<void, PlatformError, Scope.Scope>;
    readonly dataChannelLabel: (dataChannel: DataChannelHandle) => string;
    readonly createOffer: (
      peerConnection: PeerConnectionHandle,
    ) => Effect.Effect<SessionDescription, PlatformError>;
    readonly createAnswer: (
      peerConnection: PeerConnectionHandle,
    ) => Effect.Effect<SessionDescription, PlatformError>;
    readonly setLocalDescription: (
      peerConnection: PeerConnectionHandle,
      description: Required<SessionDescription>,
    ) => Effect.Effect<void, PlatformError>;
    readonly setRemoteDescription: (
      peerConnection: PeerConnectionHandle,
      description: Required<SessionDescription>,
    ) => Effect.Effect<void, PlatformError>;
    readonly addIceCandidate: (
      peerConnection: PeerConnectionHandle,
      candidate: IceCandidate,
    ) => Effect.Effect<void, PlatformError>;
    readonly sendDataChannelMessage: (
      dataChannel: DataChannelHandle,
      message: string,
    ) => Effect.Effect<void, PlatformError>;
  }
>()('@tether/client-runtime/peer-session/PeerSessionPlatform') {}

/** Emits platform-independent session events to the host UI. */
export class PeerSessionEventSink extends Context.Service<
  PeerSessionEventSink,
  {
    readonly emit: (event: PeerSessionEvent) => Effect.Effect<void, unknown>;
  }
>()('@tether/client-runtime/peer-session/PeerSessionEventSink') {}

export class PeerSessionSignaling extends Context.Service<
  PeerSessionSignaling,
  {
    readonly sendSignal: (signal: PeerSessionSignal) => Effect.Effect<void, unknown>;
  }
>()('@tether/client-runtime/peer-session/PeerSessionSignaling') {}

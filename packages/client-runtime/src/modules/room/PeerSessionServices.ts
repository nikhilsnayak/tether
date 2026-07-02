import type { IceCandidateSignal } from '@tether/contracts/modules/room';
import { Context, Effect, type Scope } from 'effect';

import type {
  DataChannelHandle,
  MediaStreamHandle,
  PeerConnectionHandle,
  PeerSessionEvent,
  PlatformError,
  PlatformEventDispatch,
  SessionDescription,
} from './PeerSessionModel';

/**
 * Platform adapter used by the shared actor to operate a peer connection.
 *
 * Implementations own native objects and expose them only through opaque
 * handles. Observer methods translate native callbacks into actor events and
 * keep their listeners alive for the surrounding Effect scope.
 */
export class PeerSessionPlatform extends Context.Service<
  PeerSessionPlatform,
  {
    readonly acquirePeerConnection: Effect.Effect<PeerConnectionHandle, PlatformError, Scope.Scope>;
    readonly acquireLocalMedia: Effect.Effect<MediaStreamHandle, PlatformError, Scope.Scope>;
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
      candidate: IceCandidateSignal,
    ) => Effect.Effect<void, PlatformError>;
    readonly sendDataChannelMessage: (
      dataChannel: DataChannelHandle,
      message: string,
    ) => Effect.Effect<void, PlatformError>;
  }
>()('@tether/client-runtime/room/PeerSessionPlatform') {}

/**
 * Output port for domain events that a platform UI can project into its own
 * state system. The web implementation writes these events into an Effect Atom;
 * a mobile implementation can provide a different sink without changing the
 * actor.
 */
export class PeerSessionEventSink extends Context.Service<
  PeerSessionEventSink,
  {
    readonly emit: (event: PeerSessionEvent) => Effect.Effect<void, unknown>;
  }
>()('@tether/client-runtime/room/PeerSessionEventSink') {}

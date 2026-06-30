import type { IceCandidateSignal } from '@tether/contracts/modules/room';
import { Context, Effect, type Scope } from 'effect';

import type {
  DataChannelHandle,
  PeerConnectionHandle,
  PeerSessionEvent,
  PlatformCommandDispatch,
  SessionDescription,
} from './PeerSessionModel';

/**
 * Platform adapter used by the shared actor to operate a peer connection.
 *
 * Implementations own native objects and expose them only through opaque
 * handles. Observer methods translate native callbacks into actor commands and
 * keep their listeners alive for the surrounding Effect scope.
 */
export class PeerSessionPlatform extends Context.Service<
  PeerSessionPlatform,
  {
    readonly acquirePeerConnection: Effect.Effect<PeerConnectionHandle, unknown, Scope.Scope>;
    readonly observePeerConnection: (
      peerConnection: PeerConnectionHandle,
      dispatch: PlatformCommandDispatch,
    ) => Effect.Effect<void, unknown, Scope.Scope>;
    readonly createDataChannel: (
      peerConnection: PeerConnectionHandle,
      label: string,
    ) => Effect.Effect<DataChannelHandle, unknown>;
    readonly observeDataChannel: (
      dataChannel: DataChannelHandle,
      dispatch: PlatformCommandDispatch,
    ) => Effect.Effect<void, unknown, Scope.Scope>;
    readonly dataChannelLabel: (dataChannel: DataChannelHandle) => string;
    readonly createOffer: (
      peerConnection: PeerConnectionHandle,
    ) => Effect.Effect<SessionDescription, unknown>;
    readonly createAnswer: (
      peerConnection: PeerConnectionHandle,
    ) => Effect.Effect<SessionDescription, unknown>;
    readonly setLocalDescription: (
      peerConnection: PeerConnectionHandle,
      description: Required<SessionDescription>,
    ) => Effect.Effect<void, unknown>;
    readonly setRemoteDescription: (
      peerConnection: PeerConnectionHandle,
      description: Required<SessionDescription>,
    ) => Effect.Effect<void, unknown>;
    readonly addIceCandidate: (
      peerConnection: PeerConnectionHandle,
      candidate: IceCandidateSignal,
    ) => Effect.Effect<void, unknown>;
    readonly sendDataChannelMessage: (
      dataChannel: DataChannelHandle,
      message: string,
    ) => Effect.Effect<void, unknown>;
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

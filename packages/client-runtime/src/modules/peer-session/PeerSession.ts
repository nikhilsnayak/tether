import type { PeerId } from '@tether/contracts/modules/room';
import { Crypto, Duration, Effect, Exit, Result, Scope } from 'effect';

import { deriveSasCode } from '../call-verification';
import type {
  PeerConnectionGeneration,
  PeerSessionActorState,
  PeerSessionInput,
  PeerSessionInputOutcome,
  PeerSessionLocalInputDispatch,
} from './ActorModel';
import {
  type DataChannelHandle,
  type IceCandidate,
  type IceServer,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PeerSessionSignal,
  type SessionDescription,
} from './Model';
import { makePeerSessionMemory } from './PeerSessionMemory';
import { isPlatformError } from './Platform';
import {
  type AvatarPose,
  type MediaState,
  ROOM_EVENTS_CHANNEL_LABEL,
  ROOM_EVENT_VERSION,
  decodeRoomEvent,
  encodeRoomEvent,
} from './RoomEvents';
import { PeerSessionEventSink, PeerSessionPlatform, PeerSessionSignaling } from './Services';

/**
 * How long a peer may stay mid-negotiation (offer/answer/data-channel opening)
 * before the actor replaces the stalled generation or, once retries are
 * exhausted, surfaces the stall. Chosen well above a healthy handshake
 * (typically < 5s) yet short enough to not feel indefinite.
 */
const NEGOTIATION_DEADLINE = Duration.seconds(20);
const MAX_RECONNECT_ATTEMPTS = 2;
const POSE_BUFFER_HIGH_WATER_BYTES = 64 * 1024;
const POSE_BUFFER_LOW_WATER_BYTES = 16 * 1024;
const POSE_RETRY_DELAY = Duration.millis(100);

const requireDescription = (description: SessionDescription, type: 'offer' | 'answer') =>
  description.sdp === undefined
    ? Effect.fail(new Error(`Failed to create ${type}: SDP is undefined`))
    : Effect.succeed({ type, sdp: description.sdp } as const);

/**
 * Creates the state machine for one peer session.
 *
 * `PeerSessionHost` serializes its inputs and owns the session lifetime.
 * Reconnects replace the current peer-connection generation, and callbacks
 * from older generations are ignored.
 *
 * ```text
 * INPUTS                              SERIALIZED PROCESSOR
 * room session open -> remote input --------+
 * platform callback -> PlatformEvent -------+--> mailbox --> actor
 * room UI commands -------------------------+
 *
 * ACTOR OUTPUTS
 * actor --> PeerSessionSignaling --> offer / answer / ICE
 *       --> PeerSessionPlatform --> WebRTC operations
 *       --> PeerSessionEventSink -> UI projection events
 *
 * SESSION FLOW
 *
 * [AwaitingRoomSession]
 *          |
 *          +-- RoomSessionOpened(peerId = null) ------> [WaitingForPeer]
 *          |                                               |
 *          |                                               +-- PeerJoined
 *          |                                                     -> answerer
 *          |
 *          +-- RoomSessionOpened(peerId = existing peer) -> offerer
 *
 * Both roles converge on [PeerKnown]. Session descriptions and ICE are
 * exchanged through signaling. The single room-events channel carries typed
 * chat, avatar-pose, and media-state envelopes, while connection failures
 * replace the current generation and retry within the reconnect budget.
 * Exhausted retries emit TransportLost; a later PeerLeft creates a fresh
 * generation and returns to [WaitingForPeer].
 *
 * ICE candidates are accepted only for the active negotiation epoch, and
 * callbacks carrying handles from closed generations are ignored.
 * ```
 */
const makePeerSessionActor = Effect.fnUntraced(function* (
  selfId: string,
  localStream: MediaStreamHandle,
  iceServers: ReadonlyArray<IceServer>,
  dispatchLocalInput: PeerSessionLocalInputDispatch,
  initialMediaState: MediaState | null = null,
) {
  const platform = yield* PeerSessionPlatform;
  const eventSink = yield* PeerSessionEventSink;
  const signaling = yield* PeerSessionSignaling;
  const crypto = yield* Crypto.Crypto;
  const actorScope = yield* Scope.Scope;
  const memory = makePeerSessionMemory(selfId, initialMediaState);
  let state: PeerSessionActorState = {
    _tag: 'AwaitingRoomSession',
  };

  const sendSignal = (signal: PeerSessionSignal) => signaling.sendSignal(signal);

  const transmitRoomEvent = Effect.fnUntraced(function* (
    dataChannel: DataChannelHandle,
    event: Parameters<typeof encodeRoomEvent>[0],
  ) {
    const encoded = encodeRoomEvent(event);
    if (Result.isFailure(encoded)) {
      yield* Effect.logWarning('Dropped invalid local room event').pipe(
        Effect.annotateLogs('reason', encoded.failure),
      );
      return false;
    }
    yield* platform.sendDataChannelMessage(dataChannel, encoded.success);
    return true;
  });

  const maybeAdvanceDetachment = Effect.fnUntraced(function* () {
    if (memory.detachment.isDetached() || state._tag !== 'PeerKnown') {
      return;
    }

    if (
      state.peerConnectionState !== 'connected' ||
      state.dataChannelState._tag !== 'DataChannelOpen' ||
      !state.iceGatheringComplete ||
      state.negotiation.phase !== 'answered'
    ) {
      return;
    }
    const { dataChannel } = state.dataChannelState;
    if (memory.detachment.needsProbe()) {
      const sent = yield* transmitRoomEvent(dataChannel, {
        version: ROOM_EVENT_VERSION,
        type: 'detach-probe',
      }).pipe(
        Effect.catchIf(isPlatformError, (error) =>
          Effect.logWarning('Failed to send detach probe').pipe(
            Effect.annotateLogs('operation', error.operation),
            Effect.as(false),
          ),
        ),
      );
      if (!sent) return;
      memory.detachment.markProbeSent();
    }

    if (
      memory.detachment.isProbeExchanged() &&
      !memory.detachment.hasDeclaredReadinessFor(state.negotiation.epoch)
    ) {
      const negotiationEpoch = state.negotiation.epoch;
      yield* signaling.sendReadyToDetach(negotiationEpoch).pipe(
        Effect.andThen(
          Effect.sync(() => {
            memory.detachment.markReadinessSent(negotiationEpoch);
          }),
        ),
        Effect.catch((error) =>
          Effect.logWarning('Failed to declare detach readiness').pipe(
            Effect.annotateLogs('reason', String(error)),
          ),
        ),
      );
    }
  });

  // Hashes the SDPs as they crossed signaling; failure downgrades to unverified.
  const emitSas = (offerSdp: string, answerSdp: string) =>
    deriveSasCode({ offerSdp, answerSdp }).pipe(
      Effect.flatMap((code) => eventSink.emit({ _tag: 'SasReady', code })),
      Effect.catch((error: unknown) =>
        Effect.logWarning('Skipped SAS derivation').pipe(
          Effect.annotateLogs('reason', String(error)),
        ),
      ),
      Effect.provideService(Crypto.Crypto, crypto),
    );

  const createAndSendOffer = Effect.fn('@tether/client-runtime/createAndSendOffer')(function* (
    peerConnection: PeerConnectionHandle,
    negotiationEpoch: number,
  ) {
    const created = yield* platform.createOffer(peerConnection);
    const offer = yield* requireDescription(created, 'offer');
    yield* platform.setLocalDescription(peerConnection, offer);
    yield* sendSignal({ _tag: 'SessionDescription', ...offer, negotiationEpoch });
    return offer.sdp;
  });

  const acceptOfferAndSendAnswer = Effect.fn('@tether/client-runtime/acceptOfferAndSendAnswer')(
    function* (
      peerConnection: PeerConnectionHandle,
      signal: Extract<PeerSessionSignal, { readonly _tag: 'SessionDescription' }>,
    ) {
      yield* platform.setRemoteDescription(peerConnection, {
        type: 'offer',
        sdp: signal.sdp,
      });

      const created = yield* platform.createAnswer(peerConnection);
      const answer = yield* requireDescription(created, 'answer');
      yield* platform.setLocalDescription(peerConnection, answer);
      yield* sendSignal({
        _tag: 'SessionDescription',
        ...answer,
        negotiationEpoch: signal.negotiationEpoch,
      });
      return answer.sdp;
    },
  );

  const acquirePeerConnectionGeneration = Effect.fnUntraced(function* () {
    const connectionScope = yield* Scope.fork(actorScope);
    const peerConnection = yield* platform
      .acquirePeerConnection(iceServers)
      .pipe(Scope.provide(connectionScope));
    yield* platform
      .observePeerConnection(peerConnection, dispatchLocalInput)
      .pipe(Scope.provide(connectionScope));

    // Attach local camera/mic before any offer/answer so a single
    // negotiation carries the media; remote tracks arrive via observation.
    yield* platform.addLocalTracks(peerConnection, localStream);

    return { scope: connectionScope, peerConnection };
  });

  /**
   * Arms a one-shot negotiation deadline for a generation. The timer is not
   * cancelled on success: it fires into the serialized input queue and the
   * handler ignores it unless the same generation is still mid-negotiation.
   * Forking it into the generation scope bounds its lifetime to the
   * connection it guards.
   */
  const armNegotiationDeadline = (generation: PeerConnectionGeneration) =>
    Effect.sleep(NEGOTIATION_DEADLINE).pipe(
      Effect.andThen(
        Effect.sync(() =>
          dispatchLocalInput({
            _tag: 'NegotiationDeadlineElapsed',
            peerConnection: generation.peerConnection,
          }),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
      Scope.provide(generation.scope),
    );

  const beginPeerReconnect = Effect.fnUntraced(function* () {
    // Unreachable: both callers (peer-connection failure and negotiation
    // deadline) narrow to PeerKnown first. This guard only narrows the state
    // for the field access below.
    /* v8 ignore next 3 */
    if (state._tag !== 'PeerKnown') {
      return;
    }

    if (memory.detachment.isDetached()) {
      const { peerId } = state;
      yield* Scope.close(state.generation.scope, Exit.void);
      state = { _tag: 'TransportLost', peerId };
      yield* Effect.logWarning('Direct transport failed after detachment');
      return yield* eventSink.emit({ _tag: 'TransportLost', peerId });
    }

    memory.detachment.resetGeneration();

    const { peerId, reconnectAttempts } = state;
    const role = state.negotiation.role;
    yield* Scope.close(state.generation.scope, Exit.void);

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      state = { _tag: 'TransportLost', peerId };
      yield* Effect.logWarning('Reconnect attempts exhausted');
      return yield* eventSink.emit({ _tag: 'TransportLost', peerId });
    }

    const generation = yield* acquirePeerConnectionGeneration();
    memory.roomEvents.resetGeneration();
    yield* eventSink.emit({ _tag: 'PeerInterrupted', peerId });

    if (role === 'answerer') {
      state = {
        _tag: 'PeerKnown',
        generation,
        peerId,
        negotiation: { role: 'answerer', phase: 'awaiting-offer' },
        peerConnectionState: 'connecting',
        iceGatheringComplete: false,
        dataChannelState: { _tag: 'AwaitingRemoteDataChannel' },
        reconnectAttempts: reconnectAttempts + 1,
      };
      yield* armNegotiationDeadline(generation);
      return;
    }

    const dataChannel = yield* platform.createDataChannel(
      generation.peerConnection,
      ROOM_EVENTS_CHANNEL_LABEL,
    );
    yield* platform
      .observeDataChannel(dataChannel, dispatchLocalInput)
      .pipe(Scope.provide(generation.scope));
    yield* armNegotiationDeadline(generation);
    const negotiationEpoch = memory.negotiation.takeLocalOfferEpoch();
    const offerSdp = yield* createAndSendOffer(generation.peerConnection, negotiationEpoch);
    state = {
      _tag: 'PeerKnown',
      generation,
      peerId,
      negotiation: {
        role: 'offerer',
        phase: 'awaiting-answer',
        epoch: negotiationEpoch,
        offerSdp,
      },
      peerConnectionState: 'connecting',
      iceGatheringComplete: false,
      dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
      reconnectAttempts: reconnectAttempts + 1,
    };
  });

  const handleRoomSessionOpened = Effect.fnUntraced(function* (peerId: PeerId | null) {
    if (state._tag !== 'AwaitingRoomSession') {
      return yield* Effect.logWarning('Ignored duplicate room session open');
    }

    const generation = yield* acquirePeerConnectionGeneration();

    if (peerId === null) {
      state = { _tag: 'WaitingForPeer', generation };
      yield* eventSink.emit({ _tag: 'WaitingForPeer' });
      return;
    }

    const dataChannel = yield* platform.createDataChannel(
      generation.peerConnection,
      ROOM_EVENTS_CHANNEL_LABEL,
    );

    yield* platform
      .observeDataChannel(dataChannel, dispatchLocalInput)
      .pipe(Scope.provide(generation.scope));

    yield* armNegotiationDeadline(generation);
    const negotiationEpoch = memory.negotiation.takeLocalOfferEpoch();
    const offerSdp = yield* createAndSendOffer(generation.peerConnection, negotiationEpoch);

    state = {
      _tag: 'PeerKnown',
      generation,
      peerId,
      negotiation: {
        role: 'offerer',
        phase: 'awaiting-answer',
        epoch: negotiationEpoch,
        offerSdp,
      },
      peerConnectionState: 'connecting',
      iceGatheringComplete: false,
      dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
      reconnectAttempts: 0,
    };
  });

  const handlePeerJoined = Effect.fnUntraced(function* (peerId: PeerId) {
    if (state._tag !== 'WaitingForPeer') {
      return;
    }

    const { generation } = state;

    state = {
      _tag: 'PeerKnown',
      generation,
      peerId,
      negotiation: { role: 'answerer', phase: 'awaiting-offer' },
      peerConnectionState: 'connecting',
      iceGatheringComplete: false,
      dataChannelState: { _tag: 'AwaitingRemoteDataChannel' },
      reconnectAttempts: 0,
    };
    yield* armNegotiationDeadline(generation);
  });

  const handleSignal = Effect.fnUntraced(function* (peerId: PeerId, signal: PeerSessionSignal) {
    if (state._tag !== 'PeerKnown' || peerId !== state.peerId) {
      return;
    }

    switch (signal._tag) {
      case 'SessionDescription': {
        if (signal.type === 'offer') {
          if (state.negotiation.role !== 'answerer') {
            return yield* Effect.logWarning('Ignored offer received in invalid role');
          }
          const offerDecision = memory.negotiation.acceptRemoteOffer(signal.negotiationEpoch);
          if (offerDecision._tag === 'Stale') {
            return yield* Effect.logWarning('Ignored stale offer negotiation epoch').pipe(
              Effect.annotateLogs({
                activeEpoch: offerDecision.latest,
                receivedEpoch: signal.negotiationEpoch,
              }),
            );
          }
          const answerSdp = yield* acceptOfferAndSendAnswer(
            state.generation.peerConnection,
            signal,
          );
          memory.detachment.resetGeneration();
          state = {
            ...state,
            negotiation: {
              role: 'answerer',
              phase: 'answered',
              epoch: signal.negotiationEpoch,
              offerSdp: signal.sdp,
              answerSdp,
            },
          };
          return;
        }

        if (state.negotiation.role !== 'offerer') {
          return yield* Effect.logWarning('Ignored answer received in invalid role');
        }
        if (signal.negotiationEpoch !== state.negotiation.epoch) {
          return yield* Effect.logWarning('Ignored answer for inactive negotiation epoch').pipe(
            Effect.annotateLogs({
              activeEpoch: state.negotiation.epoch,
              receivedEpoch: signal.negotiationEpoch,
            }),
          );
        }
        if (state.negotiation.phase === 'answered') {
          return yield* Effect.logWarning('Ignored duplicate answer');
        }
        yield* platform.setRemoteDescription(state.generation.peerConnection, {
          type: 'answer',
          sdp: signal.sdp,
        });
        state = {
          ...state,
          negotiation: {
            ...state.negotiation,
            phase: 'answered',
            answerSdp: signal.sdp,
          },
        };
        return;
      }
      case 'IceCandidate': {
        const activeEpoch =
          state.negotiation.phase === 'awaiting-offer' ? null : state.negotiation.epoch;
        if (signal.negotiationEpoch !== activeEpoch) {
          return yield* Effect.logWarning(
            'Ignored ICE candidate for inactive negotiation epoch',
          ).pipe(
            Effect.annotateLogs({
              activeEpoch,
              receivedEpoch: signal.negotiationEpoch,
            }),
          );
        }
        return yield* platform
          .addIceCandidate(state.generation.peerConnection, signal)
          .pipe(
            Effect.catchTag('PlatformError', (error) =>
              Effect.logWarning('Dropped ICE candidate that failed to apply').pipe(
                Effect.annotateLogs('operation', error.operation),
              ),
            ),
          );
      }
    }
  });

  const handlePeerLeft = Effect.fnUntraced(function* (peerId: PeerId) {
    if (state._tag === 'TransportLost' && peerId === state.peerId) {
      const newGeneration = yield* acquirePeerConnectionGeneration();
      memory.negotiation.resetRemoteOffer();
      memory.roomEvents.resetGeneration();

      state = {
        _tag: 'WaitingForPeer',
        generation: newGeneration,
      };

      yield* Effect.logInfo('Peer departed after transport loss');
      return yield* eventSink.emit({ _tag: 'PeerDeparted', peerId });
    }

    if (state._tag !== 'PeerKnown' || peerId !== state.peerId) {
      return;
    }

    yield* Scope.close(state.generation.scope, Exit.void);

    const newGeneration = yield* acquirePeerConnectionGeneration();
    memory.negotiation.resetRemoteOffer();
    memory.roomEvents.resetGeneration();

    state = {
      _tag: 'WaitingForPeer',
      generation: newGeneration,
    };

    yield* Effect.logInfo('Peer departed; waiting for replacement');
    yield* eventSink.emit({ _tag: 'PeerDeparted', peerId });
  });

  const handleRemoteDataChannel = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
    dataChannel: DataChannelHandle,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection ||
      state.negotiation.role !== 'answerer' ||
      state.dataChannelState._tag !== 'AwaitingRemoteDataChannel' ||
      platform.dataChannelLabel(dataChannel) !== ROOM_EVENTS_CHANNEL_LABEL
    ) {
      if (platform.closeDataChannel !== undefined) {
        yield* platform
          .closeDataChannel(dataChannel)
          .pipe(
            Effect.catchTag('PlatformError', (error) =>
              Effect.logWarning('Failed to close unexpected data channel').pipe(
                Effect.annotateLogs('operation', error.operation),
              ),
            ),
          );
      }
      return;
    }

    state = { ...state, dataChannelState: { _tag: 'DataChannelConnecting', dataChannel } };
    yield* platform
      .observeDataChannel(dataChannel, dispatchLocalInput)
      .pipe(Scope.provide(state.generation.scope));
  });

  const handleRemoteTrack = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
    stream: MediaStreamHandle,
  ) {
    if (state._tag !== 'PeerKnown' || state.generation.peerConnection !== peerConnection) {
      return;
    }
    yield* eventSink.emit({ _tag: 'RemoteStreamReady', stream });
  });

  const handleLocalIceCandidate = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
    candidate: IceCandidate,
  ) {
    if (
      memory.detachment.isDetached() ||
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection
    ) {
      return;
    }
    if (state.negotiation.phase === 'awaiting-offer') {
      return yield* Effect.logWarning('Ignored local ICE candidate without an active epoch');
    }
    yield* sendSignal({
      _tag: 'IceCandidate',
      ...candidate,
      negotiationEpoch: state.negotiation.epoch,
    });
  });

  const handlePeerConnectionFailed = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
  ) {
    if (
      state._tag === 'AwaitingRoomSession' ||
      state._tag === 'TransportLost' ||
      state.generation.peerConnection !== peerConnection
    ) {
      return;
    }

    if (state._tag === 'PeerKnown') {
      yield* Effect.logWarning('Peer connection failed');
      return yield* beginPeerReconnect();
    }

    yield* Scope.close(state.generation.scope, Exit.void);
    const newGeneration = yield* acquirePeerConnectionGeneration();
    state = {
      _tag: 'WaitingForPeer',
      generation: newGeneration,
    };
  });

  const handlePeerConnectionConnected = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection ||
      state.peerConnectionState !== 'connecting'
    ) {
      return;
    }

    state = { ...state, peerConnectionState: 'connected', reconnectAttempts: 0 };
    yield* Effect.logInfo('Peer connection established');
    yield* eventSink.emit({ _tag: 'Connected', peerId: state.peerId });
    if (state.negotiation.phase === 'answered') {
      yield* emitSas(state.negotiation.offerSdp, state.negotiation.answerSdp);
    }
  });

  const handleIceGatheringComplete = (peerConnection: PeerConnectionHandle) =>
    Effect.sync(() => {
      if (state._tag !== 'PeerKnown' || state.generation.peerConnection !== peerConnection) {
        return;
      }

      state = { ...state, iceGatheringComplete: true };
    });

  const handleDataChannelClosed = Effect.fnUntraced(function* (dataChannel: DataChannelHandle) {
    if (
      state._tag !== 'PeerKnown' ||
      state.dataChannelState._tag === 'AwaitingRemoteDataChannel' ||
      state.dataChannelState._tag === 'DataChannelClosed' ||
      state.dataChannelState.dataChannel !== dataChannel
    ) {
      return;
    }

    state = { ...state, dataChannelState: { _tag: 'DataChannelClosed', dataChannel } };
    memory.roomEvents.disarmAvatarRetry();
    yield* Effect.logWarning('Room events channel closed');
    yield* eventSink.emit({ _tag: 'RoomEventsUnavailable' });
  });

  const markRoomEventsUnavailable = Effect.fnUntraced(function* (dataChannel: DataChannelHandle) {
    // Called synchronously from a failed send on the actor-owned open channel.
    // The guard documents that ownership invariant for future call sites.
    /* v8 ignore next 6 */
    if (
      state._tag !== 'PeerKnown' ||
      state.dataChannelState._tag !== 'DataChannelOpen' ||
      state.dataChannelState.dataChannel !== dataChannel
    ) {
      return;
    }
    if (platform.closeDataChannel !== undefined) {
      yield* platform
        .closeDataChannel(dataChannel)
        .pipe(
          Effect.catchTag('PlatformError', (error) =>
            Effect.logWarning('Failed to close unusable room events channel').pipe(
              Effect.annotateLogs('operation', error.operation),
            ),
          ),
        );
    }
    state = { ...state, dataChannelState: { _tag: 'DataChannelClosed', dataChannel } };
    memory.roomEvents.disarmAvatarRetry();
    yield* eventSink.emit({ _tag: 'RoomEventsUnavailable' });
  });

  const sendLatestMediaState = Effect.fnUntraced(function* (dataChannel: DataChannelHandle) {
    const transmission = memory.roomEvents.nextMediaTransmission();
    if (transmission._tag === 'NothingToSend') return;
    // See PeerSessionMemory.takeCounter: this needs 2^31 sends in one generation.
    /* v8 ignore next 3 */
    if (transmission._tag === 'CounterExhausted') {
      return yield* Effect.logWarning('Local media-state revision exhausted');
    }
    yield* transmitRoomEvent(dataChannel, {
      version: ROOM_EVENT_VERSION,
      type: 'media-state',
      revision: transmission.counter,
      ...transmission.value,
    }).pipe(
      Effect.catchIf(isPlatformError, (error) =>
        Effect.logWarning('Failed to send local media state').pipe(
          Effect.annotateLogs('operation', error.operation),
          Effect.andThen(markRoomEventsUnavailable(dataChannel)),
        ),
      ),
    );
  });

  const sendLatestAvatarPose = Effect.fnUntraced(function* (dataChannel: DataChannelHandle) {
    const transmission = memory.roomEvents.nextAvatarTransmission();
    if (transmission._tag === 'NothingToSend') return;
    // See PeerSessionMemory.takeCounter: this needs 2^31 sends in one generation.
    /* v8 ignore next 3 */
    if (transmission._tag === 'CounterExhausted') {
      return yield* Effect.logWarning('Local avatar-pose sequence exhausted');
    }
    const sent = yield* transmitRoomEvent(dataChannel, {
      version: ROOM_EVENT_VERSION,
      type: 'avatar-pose',
      sequence: transmission.counter,
      ...transmission.value,
    }).pipe(
      Effect.catchIf(isPlatformError, (error) =>
        Effect.logWarning('Failed to send local avatar pose').pipe(
          Effect.annotateLogs('operation', error.operation),
          Effect.andThen(markRoomEventsUnavailable(dataChannel)),
          Effect.as(false),
        ),
      ),
    );
    if (sent) memory.roomEvents.markAvatarPoseSent();
  });

  const armAvatarPoseRetry = (
    peerConnection: PeerConnectionHandle,
    dataChannel: DataChannelHandle,
  ) => {
    if (memory.roomEvents.isAvatarRetryArmed() || state._tag !== 'PeerKnown') {
      return Effect.void;
    }
    memory.roomEvents.armAvatarRetry();
    return Effect.sleep(POSE_RETRY_DELAY).pipe(
      Effect.andThen(
        Effect.sync(() =>
          dispatchLocalInput({
            _tag: 'RetryPendingAvatarPose',
            peerConnection,
            dataChannel,
          }),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
      Scope.provide(state.generation.scope),
    );
  };

  const flushOrRetryAvatarPose = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
    dataChannel: DataChannelHandle,
  ) {
    if (!memory.roomEvents.hasPendingAvatarPose()) return;
    const bufferedAmount = platform.dataChannelBufferedAmount?.(dataChannel);
    if (bufferedAmount !== undefined && bufferedAmount > POSE_BUFFER_LOW_WATER_BYTES) {
      yield* armAvatarPoseRetry(peerConnection, dataChannel);
      return;
    }
    yield* sendLatestAvatarPose(dataChannel);
  });

  const queueOrSendAvatarPose = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
    dataChannel: DataChannelHandle,
  ) {
    const bufferedAmount = platform.dataChannelBufferedAmount?.(dataChannel);
    if (bufferedAmount !== undefined && bufferedAmount >= POSE_BUFFER_HIGH_WATER_BYTES) {
      yield* armAvatarPoseRetry(peerConnection, dataChannel);
      return;
    }
    yield* sendLatestAvatarPose(dataChannel);
  });

  const handlePeerConnectionInterrupted = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection ||
      state.peerConnectionState !== 'connected'
    ) {
      return;
    }

    state = { ...state, peerConnectionState: 'interrupted' };
    yield* Effect.logWarning('Peer connection interrupted');
    yield* eventSink.emit({ _tag: 'PeerInterrupted', peerId: state.peerId });
  });

  const handlePeerConnectionRestored = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection ||
      state.peerConnectionState !== 'interrupted'
    ) {
      return;
    }

    state = { ...state, peerConnectionState: 'connected', reconnectAttempts: 0 };
    yield* Effect.logInfo('Peer connection restored');
    yield* eventSink.emit({ _tag: 'PeerRestored', peerId: state.peerId });
    if (state.dataChannelState._tag === 'DataChannelOpen') {
      yield* eventSink.emit({ _tag: 'RoomEventsReady' });
    }
    if (state.negotiation.phase === 'answered') {
      yield* emitSas(state.negotiation.offerSdp, state.negotiation.answerSdp);
    }
  });

  const handleDataChannelOpened = Effect.fnUntraced(function* (dataChannel: DataChannelHandle) {
    if (
      state._tag === 'PeerKnown' &&
      state.dataChannelState._tag === 'DataChannelOpen' &&
      state.dataChannelState.dataChannel === dataChannel
    ) {
      return;
    }

    if (
      state._tag !== 'PeerKnown' ||
      state.dataChannelState._tag !== 'DataChannelConnecting' ||
      state.dataChannelState.dataChannel !== dataChannel
    ) {
      return;
    }

    state = {
      ...state,
      dataChannelState: { _tag: 'DataChannelOpen', dataChannel },
    };
    yield* Effect.logInfo('Data channel opened');
    yield* eventSink.emit({ _tag: 'RoomEventsReady' });
    yield* sendLatestMediaState(dataChannel);
    if (
      state._tag === 'PeerKnown' &&
      state.dataChannelState._tag === 'DataChannelOpen' &&
      state.dataChannelState.dataChannel === dataChannel
    ) {
      yield* queueOrSendAvatarPose(state.generation.peerConnection, dataChannel);
    }
  });

  const handleDataChannelMessage = Effect.fnUntraced(function* (
    dataChannel: DataChannelHandle,
    data: unknown,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.dataChannelState._tag !== 'DataChannelOpen' ||
      state.dataChannelState.dataChannel !== dataChannel
    ) {
      return;
    }
    const decoded = decodeRoomEvent(data);
    if (Result.isFailure(decoded)) {
      return yield* Effect.logWarning('Dropped invalid room event').pipe(
        Effect.annotateLogs('reason', decoded.failure),
      );
    }

    switch (decoded.success.type) {
      case 'detach-probe':
        if (!memory.detachment.markProbeReceived()) return;
        return;
      case 'leave': {
        if (!memory.detachment.isDetached()) {
          return yield* Effect.logWarning('Ignored leave envelope before detachment');
        }
        const { peerId, generation } = state;
        yield* Scope.close(generation.scope, Exit.void);
        state = { _tag: 'TransportLost', peerId };
        yield* Effect.logInfo('Peer departed over the data channel');
        return yield* eventSink.emit({ _tag: 'PeerDeparted', peerId });
      }
      case 'chat-message':
        return yield* eventSink.emit({
          _tag: 'ChatMessageAdded',
          message: {
            id: memory.chat.nextMessageId('peer'),
            sender: 'peer',
            text: decoded.success.text,
          },
        });
      case 'avatar-pose':
        if (!memory.roomEvents.acceptRemoteAvatarSequence(decoded.success.sequence)) return;
        return yield* eventSink.emit({
          _tag: 'RemoteAvatarPoseChanged',
          pose: {
            sequence: decoded.success.sequence,
            x: decoded.success.x,
            z: decoded.success.z,
            yaw: decoded.success.yaw,
            action: decoded.success.action,
          },
        });
      case 'media-state':
        if (!memory.roomEvents.acceptRemoteMediaRevision(decoded.success.revision)) return;
        return yield* eventSink.emit({
          _tag: 'RemoteMediaStateChanged',
          mediaState: {
            revision: decoded.success.revision,
            cameraOn: decoded.success.cameraOn,
            microphoneOn: decoded.success.microphoneOn,
          },
        });
    }
  });

  const handleNegotiationDeadlineElapsed = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection ||
      state.peerConnectionState === 'connected'
    ) {
      return;
    }

    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      yield* Effect.logWarning('Negotiation stalled');
      return yield* eventSink.emit({ _tag: 'NegotiationStalled', peerId: state.peerId });
    }

    return yield* beginPeerReconnect();
  });

  const handleUiSendMessage = Effect.fnUntraced(function* (text: string) {
    if (state._tag !== 'PeerKnown' || state.dataChannelState._tag !== 'DataChannelOpen') {
      return;
    }

    const dataChannel = state.dataChannelState.dataChannel;
    const sent = yield* transmitRoomEvent(dataChannel, {
      version: ROOM_EVENT_VERSION,
      type: 'chat-message',
      text,
    }).pipe(
      Effect.catchIf(isPlatformError, (error) =>
        Effect.logWarning('Failed to send chat message').pipe(
          Effect.annotateLogs('operation', error.operation),
          Effect.andThen(markRoomEventsUnavailable(dataChannel)),
          Effect.as(false),
        ),
      ),
    );
    if (!sent) return;
    yield* eventSink.emit({
      _tag: 'ChatMessageAdded',
      message: { id: memory.chat.nextMessageId('self'), sender: 'self', text },
    });
  });

  const handleUiSendAvatarPose = Effect.fnUntraced(function* (pose: AvatarPose) {
    memory.roomEvents.rememberAvatarPose(pose);
    if (state._tag !== 'PeerKnown' || state.dataChannelState._tag !== 'DataChannelOpen') {
      return;
    }
    yield* queueOrSendAvatarPose(
      state.generation.peerConnection,
      state.dataChannelState.dataChannel,
    );
  });

  const handleUiSendMediaState = Effect.fnUntraced(function* (mediaState: MediaState) {
    memory.roomEvents.rememberMediaState(mediaState);
    if (state._tag !== 'PeerKnown' || state.dataChannelState._tag !== 'DataChannelOpen') {
      return;
    }
    yield* sendLatestMediaState(state.dataChannelState.dataChannel);
  });

  const handleUiSendLeave = Effect.fnUntraced(function* () {
    if (state._tag !== 'PeerKnown' || state.dataChannelState._tag !== 'DataChannelOpen') {
      return;
    }
    yield* transmitRoomEvent(state.dataChannelState.dataChannel, {
      version: ROOM_EVENT_VERSION,
      type: 'leave',
    }).pipe(
      Effect.catchIf(isPlatformError, (error) =>
        Effect.logWarning('Failed to send leave envelope').pipe(
          Effect.annotateLogs('operation', error.operation),
          Effect.as(false),
        ),
      ),
    );
  });

  const handleDetached = Effect.fnUntraced(function* () {
    if (!memory.detachment.markDetached()) return;
    yield* Effect.logInfo('Call detached from signaling server');
    yield* eventSink.emit({ _tag: 'SessionDetached' });
  });

  const handleRetryPendingAvatarPose = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
    dataChannel: DataChannelHandle,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection ||
      state.dataChannelState._tag !== 'DataChannelOpen' ||
      state.dataChannelState.dataChannel !== dataChannel
    ) {
      return;
    }
    memory.roomEvents.disarmAvatarRetry();
    yield* flushOrRetryAvatarPose(peerConnection, dataChannel);
  });

  const dispatchInput = Effect.fnUntraced(function* (
    input: Exclude<PeerSessionInput, { readonly _tag: 'SignalingEnded' }>,
  ) {
    switch (input._tag) {
      case 'RoomSessionOpened':
        return yield* handleRoomSessionOpened(input.peerId);
      case 'PeerJoined':
        return yield* handlePeerJoined(input.peerId);
      case 'SignalReceived':
        return yield* handleSignal(input.peerId, input.signal);
      case 'PeerLeft':
        return yield* handlePeerLeft(input.peerId);
      case 'Detached':
        return yield* handleDetached();
      case 'RemoteDataChannel':
        return yield* handleRemoteDataChannel(input.peerConnection, input.dataChannel);
      case 'LocalIceCandidate':
        return yield* handleLocalIceCandidate(input.peerConnection, input.candidate);
      case 'RemoteTrackReceived':
        return yield* handleRemoteTrack(input.peerConnection, input.stream);
      case 'DataChannelOpened':
        return yield* handleDataChannelOpened(input.dataChannel);
      case 'DataChannelMessageReceived':
        return yield* handleDataChannelMessage(input.dataChannel, input.data);
      case 'PeerConnectionFailed':
        return yield* handlePeerConnectionFailed(input.peerConnection);
      case 'PeerConnectionConnected':
        return yield* handlePeerConnectionConnected(input.peerConnection);
      case 'IceGatheringComplete':
        return yield* handleIceGatheringComplete(input.peerConnection);
      case 'DataChannelClosed':
        return yield* handleDataChannelClosed(input.dataChannel);
      case 'PeerConnectionInterrupted':
        return yield* handlePeerConnectionInterrupted(input.peerConnection);
      case 'PeerConnectionRestored':
        return yield* handlePeerConnectionRestored(input.peerConnection);
      case 'NegotiationDeadlineElapsed':
        return yield* handleNegotiationDeadlineElapsed(input.peerConnection);
      case 'RetryPendingAvatarPose':
        return yield* handleRetryPendingAvatarPose(input.peerConnection, input.dataChannel);
      case 'SendMessage':
        return yield* handleUiSendMessage(input.message);
      case 'SendAvatarPose':
        return yield* handleUiSendAvatarPose(input.pose);
      case 'SendMediaState':
        return yield* handleUiSendMediaState(input.mediaState);
      case 'SendLeave':
        return yield* handleUiSendLeave();
    }
  });

  const handleInput = Effect.fnUntraced(function* (input: PeerSessionInput) {
    if (input._tag === 'SignalingEnded') {
      if (memory.detachment.isDetached()) {
        yield* Effect.logInfo('Signaling ended after detachment; ignoring');
        return 'continue' satisfies PeerSessionInputOutcome;
      }
      if (memory.detachment.hasDeclaredReadiness()) {
        yield* Effect.logInfo('Signaling ended after readiness; detaching implicitly');
        yield* handleDetached();
        return 'continue' satisfies PeerSessionInputOutcome;
      }
      yield* Effect.logInfo('Signaling stream ended');
      return 'stop' satisfies PeerSessionInputOutcome;
    }
    yield* dispatchInput(input);
    yield* maybeAdvanceDetachment();
    return 'continue' satisfies PeerSessionInputOutcome;
  });

  return { handleInput };
});

export { makePeerSessionActor };

import {
  IceCandidateSignal,
  SessionDescriptionSignal,
  type PeerId,
  type RoomEvent,
  type RoomId,
  type Signal,
} from '@tether/contracts/modules/room';
import { Crypto, Deferred, Duration, Effect, Exit, Scope } from 'effect';

import { AppClient } from '../../AppClient';
import { deriveSasCode } from '../call-verification';
import type {
  PeerConnectionGeneration,
  PeerSessionActorState,
  PeerSessionInput,
  PeerSessionLocalInputDispatch,
} from './PeerSessionActorModel';
import {
  CHAT_CHANNEL_LABEL,
  type ChatMessage,
  type DataChannelHandle,
  type IceCandidate,
  type IceServer,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type RoomSession,
  type SessionDescription,
} from './PeerSessionModel';
import { PeerSessionEventSink, PeerSessionPlatform } from './PeerSessionServices';

/**
 * How long a peer may stay mid-negotiation (offer/answer/data-channel opening)
 * before the actor replaces the stalled generation or, once retries are
 * exhausted, surfaces the stall. Chosen well above a healthy handshake
 * (typically < 5s) yet short enough to not feel indefinite.
 */
const NEGOTIATION_DEADLINE = Duration.seconds(20);
const MAX_RECONNECT_ATTEMPTS = 2;

const requireDescription = (description: SessionDescription, type: 'offer' | 'answer') =>
  description.sdp === undefined
    ? Effect.fail(new Error(`Failed to create ${type}: SDP is undefined`))
    : Effect.succeed({ type, sdp: description.sdp } as const);

/**
 * Builds the platform-neutral actor for a peer session.
 * Inputs must be handled serially; PeerSessionHost owns that serialization.
 */
const makePeerSessionActorInternal = Effect.fnUntraced(function* (
  session: RoomSession,
  localStream: MediaStreamHandle,
  iceServers: ReadonlyArray<IceServer>,
  dispatchLocalInput: PeerSessionLocalInputDispatch,
) {
  const client = yield* AppClient;
  const platform = yield* PeerSessionPlatform;
  const eventSink = yield* PeerSessionEventSink;
  const crypto = yield* Crypto.Crypto;
  const actorScope = yield* Scope.Scope;
  // Both intents learn the effective roomId and token from RoomSessionOpenedEvent.
  // A Deferred models that one-time transition and lets early RPCs wait for it.
  const openedSession = yield* Deferred.make<{
    readonly roomId: RoomId;
    readonly sessionToken: string;
  }>();
  let nextMessageSequence = 0;
  let nextOfferEpoch = 0;
  let latestRemoteOfferEpoch: number | null = null;
  let state: PeerSessionActorState = {
    _tag: 'AwaitingRoomSession',
  };

  const makeMessageId = (sender: ChatMessage['sender']) =>
    `${session.selfId}:${sender}:${nextMessageSequence++}`;

  const sendSignal = Effect.fnUntraced(function* (signal: Signal) {
    const { roomId, sessionToken } = yield* Deferred.await(openedSession);
    yield* client.SendSignal({ selfId: session.selfId, roomId, sessionToken, signal });
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
    yield* sendSignal(new SessionDescriptionSignal({ ...offer, negotiationEpoch }));
    return offer.sdp;
  });

  const acceptOfferAndSendAnswer = Effect.fn('@tether/client-runtime/acceptOfferAndSendAnswer')(
    function* (peerConnection: PeerConnectionHandle, signal: SessionDescriptionSignal) {
      yield* platform.setRemoteDescription(peerConnection, {
        type: 'offer',
        sdp: signal.sdp,
      });

      const created = yield* platform.createAnswer(peerConnection);
      const answer = yield* requireDescription(created, 'answer');
      yield* platform.setLocalDescription(peerConnection, answer);
      yield* sendSignal(
        new SessionDescriptionSignal({
          ...answer,
          negotiationEpoch: signal.negotiationEpoch,
        }),
      );
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

    const { peerId, role, reconnectAttempts } = state;
    yield* Scope.close(state.generation.scope, Exit.void);

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      state = { _tag: 'TransportLost', peerId };
      yield* Effect.logWarning('Reconnect attempts exhausted');
      return yield* eventSink.emit({ _tag: 'TransportLost', peerId });
    }

    const generation = yield* acquirePeerConnectionGeneration();
    yield* eventSink.emit({ _tag: 'PeerInterrupted', peerId });

    if (role === 'answerer') {
      state = {
        _tag: 'PeerKnown',
        generation,
        peerId,
        role,
        peerConnectionState: 'connecting',
        dataChannelState: { _tag: 'AwaitingRemoteDataChannel' },
        negotiationEpoch: null,
        reconnectAttempts: reconnectAttempts + 1,
        offerSdp: null,
        answerSdp: null,
      };
      yield* armNegotiationDeadline(generation);
      return;
    }

    const dataChannel = yield* platform.createDataChannel(
      generation.peerConnection,
      CHAT_CHANNEL_LABEL,
    );
    yield* platform
      .observeDataChannel(dataChannel, dispatchLocalInput)
      .pipe(Scope.provide(generation.scope));
    yield* armNegotiationDeadline(generation);
    const negotiationEpoch = nextOfferEpoch++;
    const offerSdp = yield* createAndSendOffer(generation.peerConnection, negotiationEpoch);
    state = {
      _tag: 'PeerKnown',
      generation,
      peerId,
      role,
      peerConnectionState: 'connecting',
      dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
      negotiationEpoch,
      reconnectAttempts: reconnectAttempts + 1,
      offerSdp,
      answerSdp: null,
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
      CHAT_CHANNEL_LABEL,
    );

    yield* platform
      .observeDataChannel(dataChannel, dispatchLocalInput)
      .pipe(Scope.provide(generation.scope));

    yield* armNegotiationDeadline(generation);
    const negotiationEpoch = nextOfferEpoch++;
    const offerSdp = yield* createAndSendOffer(generation.peerConnection, negotiationEpoch);

    state = {
      _tag: 'PeerKnown',
      generation,
      peerId,
      role: 'offerer',
      peerConnectionState: 'connecting',
      dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
      negotiationEpoch,
      reconnectAttempts: 0,
      offerSdp,
      answerSdp: null,
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
      role: 'answerer',
      peerConnectionState: 'connecting',
      dataChannelState: { _tag: 'AwaitingRemoteDataChannel' },
      negotiationEpoch: null,
      reconnectAttempts: 0,
      offerSdp: null,
      answerSdp: null,
    };
    yield* armNegotiationDeadline(generation);
  });

  const handleSignal = Effect.fnUntraced(function* (
    peerId: PeerId,
    signal: SessionDescriptionSignal | IceCandidateSignal,
  ) {
    if (state._tag !== 'PeerKnown' || peerId !== state.peerId) {
      return;
    }

    switch (signal._tag) {
      case '@tether/SessionDescriptionSignal': {
        if (signal.type === 'offer') {
          if (state.role !== 'answerer') {
            return yield* Effect.logWarning('Ignored offer received in invalid role');
          }
          if (
            latestRemoteOfferEpoch !== null &&
            signal.negotiationEpoch <= latestRemoteOfferEpoch
          ) {
            return yield* Effect.logWarning('Ignored stale offer negotiation epoch').pipe(
              Effect.annotateLogs({
                activeEpoch: latestRemoteOfferEpoch,
                receivedEpoch: signal.negotiationEpoch,
              }),
            );
          }
          const answerSdp = yield* acceptOfferAndSendAnswer(
            state.generation.peerConnection,
            signal,
          );
          latestRemoteOfferEpoch = signal.negotiationEpoch;
          state = {
            ...state,
            negotiationEpoch: signal.negotiationEpoch,
            offerSdp: signal.sdp,
            answerSdp,
          };
          return;
        }

        if (state.role !== 'offerer') {
          return yield* Effect.logWarning('Ignored answer received in invalid role');
        }
        if (signal.negotiationEpoch !== state.negotiationEpoch) {
          return yield* Effect.logWarning('Ignored answer for inactive negotiation epoch').pipe(
            Effect.annotateLogs({
              activeEpoch: state.negotiationEpoch,
              receivedEpoch: signal.negotiationEpoch,
            }),
          );
        }
        if (state.answerSdp !== null) {
          return yield* Effect.logWarning('Ignored duplicate answer');
        }
        yield* platform.setRemoteDescription(state.generation.peerConnection, {
          type: 'answer',
          sdp: signal.sdp,
        });
        state = { ...state, answerSdp: signal.sdp };
        return;
      }
      case '@tether/IceCandidateSignal': {
        if (signal.negotiationEpoch !== state.negotiationEpoch) {
          return yield* Effect.logWarning(
            'Ignored ICE candidate for inactive negotiation epoch',
          ).pipe(
            Effect.annotateLogs({
              activeEpoch: state.negotiationEpoch,
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
      latestRemoteOfferEpoch = null;

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
    latestRemoteOfferEpoch = null;

    state = {
      _tag: 'WaitingForPeer',
      generation: newGeneration,
    };

    yield* Effect.logInfo('Peer departed; waiting for replacement');
    yield* eventSink.emit({ _tag: 'PeerDeparted', peerId });
  });

  const handleRoomEvent = Effect.fnUntraced(function* (event: RoomEvent) {
    switch (event._tag) {
      case '@tether/RoomSessionOpenedEvent': {
        yield* Deferred.succeed(openedSession, {
          roomId: event.roomId,
          sessionToken: event.sessionToken,
        });
        yield* eventSink.emit({ _tag: 'RoomOpened', roomId: event.roomId });
        return yield* handleRoomSessionOpened(event.peerId);
      }
      case '@tether/PeerJoinedEvent':
        return yield* handlePeerJoined(event.peerId);
      case '@tether/SignalReceivedEvent':
        return yield* handleSignal(event.peerId, event.signal);
      case '@tether/PeerLeftEvent':
        return yield* handlePeerLeft(event.peerId);
      // Pending-phase events precede negotiation, so they only surface to the UI
      // and never touch the connection state machine.
      case '@tether/JoinRequestedEvent':
        return yield* eventSink.emit({
          _tag: 'JoinRequestReceived',
          peerId: event.peerId,
          displayName: event.displayName,
        });
      case '@tether/JoinPendingEvent':
        return yield* eventSink.emit({ _tag: 'JoinPending' });
      case '@tether/JoinCancelledEvent':
        return yield* eventSink.emit({ _tag: 'JoinRequestCancelled', peerId: event.peerId });
    }
  });

  const handleRemoteDataChannel = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
    dataChannel: DataChannelHandle,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection ||
      state.role !== 'answerer' ||
      state.dataChannelState._tag !== 'AwaitingRemoteDataChannel' ||
      platform.dataChannelLabel(dataChannel) !== CHAT_CHANNEL_LABEL
    ) {
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
    if (state._tag !== 'PeerKnown' || state.generation.peerConnection !== peerConnection) {
      return;
    }
    if (state.negotiationEpoch === null) {
      return yield* Effect.logWarning('Ignored local ICE candidate without an active epoch');
    }
    yield* sendSignal(
      new IceCandidateSignal({ ...candidate, negotiationEpoch: state.negotiationEpoch }),
    );
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
    if (state.offerSdp !== null && state.answerSdp !== null) {
      yield* emitSas(state.offerSdp, state.answerSdp);
    }
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
    yield* Effect.logWarning('Data channel closed; chat is unavailable');
    yield* eventSink.emit({ _tag: 'ChatUnavailable' });
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
      yield* eventSink.emit({ _tag: 'ChatReady' });
    }
    if (state.offerSdp !== null && state.answerSdp !== null) {
      yield* emitSas(state.offerSdp, state.answerSdp);
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
    yield* eventSink.emit({ _tag: 'ChatReady' });
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
    if (typeof data !== 'string') {
      return yield* Effect.logWarning('Ignored non-text chat payload');
    }

    yield* eventSink.emit({
      _tag: 'ChatMessageAdded',
      message: { id: makeMessageId('peer'), sender: 'peer', text: data },
    });
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

    yield* platform.sendDataChannelMessage(state.dataChannelState.dataChannel, text);
    yield* eventSink.emit({
      _tag: 'ChatMessageAdded',
      message: { id: makeMessageId('self'), sender: 'self', text },
    });
  });

  const handleInput = Effect.fnUntraced(function* (input: PeerSessionInput) {
    switch (input._tag) {
      case 'RoomEvent':
        return yield* handleRoomEvent(input.event);
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
      case 'DataChannelClosed':
        return yield* handleDataChannelClosed(input.dataChannel);
      case 'PeerConnectionInterrupted':
        return yield* handlePeerConnectionInterrupted(input.peerConnection);
      case 'PeerConnectionRestored':
        return yield* handlePeerConnectionRestored(input.peerConnection);
      case 'NegotiationDeadlineElapsed':
        return yield* handleNegotiationDeadlineElapsed(input.peerConnection);
      case 'SendMessage':
        return yield* handleUiSendMessage(input.message);
    }
  });

  return { handleInput, openedSession };
});

/**
 * Creates the state machine for one peer session.
 *
 * `PeerSessionHost` serializes its inputs and manages its lifetime. Reconnects
 * replace the current peer-connection generation, and callbacks from older
 * generations are ignored.
 *
 * ```text
 * INPUTS                              SERIALIZED PROCESSOR
 * OpenRoomSession -> RoomEvent -------------+
 * platform callback -> PlatformEvent -------+--> merged stream --> actor
 * sendMessage -> SendMessage ---------------+
 *
 * ACTOR OUTPUTS
 * actor --> SendSignal RPC ---------> offer / answer / ICE
 *       --> PeerSessionPlatform ----> WebRTC operations
 *       --> PeerSessionEventSink ---> UI projection events
 *
 * RESOURCE OWNERSHIP
 *
 * [sessionScope: owned by the host UI]
 *          |
 *          +-- [mediaScope]
 *          |     - owns local camera + microphone
 *          |     - closes when the actor terminates
 *          |
 *          +-- [actor fiber]
 *                |
 *                +-- [actorScope]
 *                      - owns replaceable connection-generation scopes
 *                      - actor owns the server-issued session-token ref
 *
 * The session scope may remain alive to display a terminal state after the
 * actor and media scopes have closed.
 *
 *
 * COMMON START
 *
 * [AwaitingRoomSession]
 *          |
 *          | RoomSessionOpened
 *          | - store the server-issued session token
 *          | - fork a connection-generation scope
 *          | - acquire and observe its peer connection
 *          |
 *          +-- peerId = null ---------> ANSWERER PATH
 *          |
 *          +-- peerId = existing -----> OFFERER PATH
 *
 *
 * ANSWERER PATH (first peer in the room)
 *
 * [WaitingForPeer]
 *          |
 *          | PeerJoined(peerId)
 *          v
 * [PeerKnown]
 *   role: answerer
 *   channel: AwaitingRemoteDataChannel
 *          |
 *          +-- SignalReceived(newer offer epoch)
 *          |     - adopt the epoch and set the remote offer
 *          |     - create and set local answer
 *          |     - SendSignal(answer with the same epoch)
 *          |
 *          +-- RemoteDataChannel(label = "chat")
 *                - observe channel events
 *                v
 * [PeerKnown]
 *   role: answerer
 *   channel: DataChannelConnecting
 *
 *
 * OFFERER PATH (second peer in the room)
 *
 * RoomSessionOpened(peerId = existing peer)
 *          |
 *          | - create and observe local "chat" data channel
 *          | - allocate the next session-local negotiation epoch
 *          | - create and set local offer
 *          | - SendSignal(offer with the allocated epoch)
 *          v
 * [PeerKnown]
 *   role: offerer
 *   channel: DataChannelConnecting
 *          |
 *          | SignalReceived(answer with the active epoch)
 *          | - set remote answer
 *
 *
 * TRANSPORT CONNECTIVITY (independent of the chat data channel)
 *
 * [PeerKnown + connection: connecting]
 *          |
 *          | PeerConnectionConnected
 *          | - emit Connected(peerId), then SasReady(code)
 *          v
 * [PeerKnown + connection: connected]
 *
 *
 * CHAT CHANNEL
 *
 * [PeerKnown + DataChannelConnecting]
 *          |
 *          | DataChannelOpened
 *          v
 * [PeerKnown + DataChannelOpen]
 *          |
 *          +-- DataChannelMessageReceived(text)
 *          |     - emit peer ChatMessageAdded
 *          |
 *          +-- SendMessage(text)
 *                - send over the data channel
 *                - emit self ChatMessageAdded
 *          |
 *          +-- DataChannelClosed
 *                - emit ChatUnavailable
 *                - keep the peer connection and media alive
 *
 *
 * ACTIVE PEER DEPARTURE
 *
 * [PeerKnown + current generation]
 *          |
 *          | PeerLeft(active peer)
 *          | - close current generation and its listeners
 *          | - acquire a fresh generation
 *          | - emit PeerDeparted(peerId)
 *          v
 * [WaitingForPeer + fresh generation]
 *
 * Queued callbacks from the closed generation retain its old opaque handle;
 * connection and channel identity checks reject them.
 *
 *
 * AUTOMATIC RECONNECTION (generation-scoped, not session-scoped)
 *
 * PeerConnectionFailed(current generation while PeerKnown)
 *   OR NegotiationDeadlineElapsed(mid-negotiation, retries remain)
 *          |
 *          | - close current generation
 *          | - acquire and observe a fresh generation
 *          | - emit PeerInterrupted(peerId)
 *          | - preserve role and increment reconnect attempts
 *          |
 *          +-- offerer: allocate a new epoch, create a fresh channel, and send a new offer
 *          |
 *          +-- answerer: await the peer's offer and remote channel
 *
 * PeerConnectionConnected resets the reconnect-attempt budget.
 *
 * PeerConnectionFailed after 2 attempts
 *          |
 *          | - close current generation
 *          | - emit TransportLost(peerId)
 *          v
 * [TransportLost(peerId) + signaling remains alive]
 *          |
 *          | PeerLeft(same peer)
 *          | - acquire a fresh generation
 *          | - emit PeerDeparted
 *          v
 * [WaitingForPeer + fresh generation]
 *
 * NegotiationDeadlineElapsed after 2 attempts
 *   -> emit NegotiationStalled(peerId)
 *
 * PeerConnectionFailed(current generation while WaitingForPeer)
 *          |
 *          | - close the failed generation
 *          | - acquire a fresh generation
 *          v
 * [WaitingForPeer + fresh generation]
 *
 *
 * ICE EXCHANGE (while PeerKnown)
 *
 * LocalIceCandidate(active epoch)
 *   -> SendSignal(ice candidate with the active epoch)
 *
 * SignalReceived(active peer, ice candidate with the active epoch)
 *   -> platform.addIceCandidate(peer connection, candidate)
 * ```
 */
export const makePeerSessionActor = makePeerSessionActorInternal;

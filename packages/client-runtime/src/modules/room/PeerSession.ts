import {
  isPeerAlreadyJoined,
  isPeerNotInRoom,
  isRoomFull,
  SessionDescriptionSignal,
  type IceCandidateSignal,
  type IceServer,
  type PeerId,
  type RoomEvent,
  type SessionDescriptionSignal as SessionDescriptionSignalType,
  type Signal,
} from '@tether/contracts/modules/room';
import { Cause, Duration, Effect, Exit, Option, Queue, Ref, Scope, Stream } from 'effect';

import { AppClient } from '../../AppClient';
import {
  CHAT_CHANNEL_LABEL,
  isPlatformError,
  type ChatMessage,
  type DataChannelHandle,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PlatformEvent,
  type RoomSession,
  type SessionDescription,
} from './PeerSessionModel';
import { PeerSessionEventSink, PeerSessionPlatform } from './PeerSessionServices';

type PeerRole = 'offerer' | 'answerer';

type DataChannelState =
  | {
      readonly _tag: 'AwaitingRemoteDataChannel';
    }
  | {
      readonly _tag: 'DataChannelConnecting';
      readonly dataChannel: DataChannelHandle;
    }
  | {
      readonly _tag: 'DataChannelOpen';
      readonly dataChannel: DataChannelHandle;
    };

type PeerSessionActorState =
  | {
      readonly _tag: 'AwaitingRoomSession';
    }
  | {
      readonly _tag: 'WaitingForPeer';
      readonly generation: PeerConnectionGeneration;
    }
  | {
      readonly _tag: 'PeerKnown';
      readonly generation: PeerConnectionGeneration;
      readonly peerId: PeerId;
      readonly role: PeerRole;
      readonly dataChannelState: DataChannelState;
      readonly remoteAnswerApplied: boolean;
      readonly reconnectAttempts: number;
    }
  | { _tag: 'TransportLost'; peerId: PeerId };

type PeerSessionUiCommand = {
  readonly _tag: 'SendMessage';
  readonly message: string;
};

/**
 * Internal input raised by the negotiation deadline timer. It carries the
 * connection it was armed for so a deadline from a superseded generation is
 * rejected by the same identity check used for stale platform callbacks.
 */
type PeerSessionTimerInput = {
  readonly _tag: 'NegotiationDeadlineElapsed';
  readonly peerConnection: PeerConnectionHandle;
};

type PeerSessionLocalInput = PlatformEvent | PeerSessionUiCommand | PeerSessionTimerInput;

/**
 * How long a peer may stay mid-negotiation (offer/answer/data-channel opening)
 * before the actor replaces the stalled generation or, once retries are
 * exhausted, surfaces the stall. Chosen well above a healthy handshake
 * (typically < 5s) yet short enough to not feel indefinite.
 */
const NEGOTIATION_DEADLINE = Duration.seconds(20);
const MAX_RECONNECT_ATTEMPTS = 2;

type PeerSessionLocalInputDispatch = (input: PeerSessionLocalInput) => void;

type PeerSessionInput =
  | {
      readonly _tag: 'RoomEvent';
      readonly event: RoomEvent;
    }
  | PeerSessionLocalInput;

type PeerConnectionGeneration = {
  readonly scope: Scope.Closeable;
  readonly peerConnection: PeerConnectionHandle;
};

const requireDescription = (description: SessionDescription, type: 'offer' | 'answer') =>
  description.sdp === undefined
    ? Effect.fail(new Error(`Failed to create ${type}: SDP is undefined`))
    : Effect.succeed({ type, sdp: description.sdp } as const);

/**
 * Builds the stateful input handler for one peer session.
 *
 * The handler deliberately has no browser or React knowledge. It mutates one
 * private state value and interprets each input using the injected RPC,
 * platform, and event-sink services. Its returned `handleInput` function must
 * be called serially; {@link startPeerSession} provides that serialization in
 * production, while tests can drive it directly. The returned session-token
 * ref is actor-owned and exposed read-only to the session's leave operation.
 */
export const makePeerSessionActor = Effect.fnUntraced(function* (
  session: RoomSession,
  localStream: MediaStreamHandle,
  iceServers: ReadonlyArray<IceServer>,
  dispatchLocalInput: PeerSessionLocalInputDispatch,
) {
  const client = yield* AppClient;
  const platform = yield* PeerSessionPlatform;
  const eventSink = yield* PeerSessionEventSink;
  const actorScope = yield* Scope.Scope;
  const sessionTokenRef = yield* Ref.make('');
  let nextMessageSequence = 0;
  let state: PeerSessionActorState = {
    _tag: 'AwaitingRoomSession',
  };

  const makeMessageId = (sender: ChatMessage['sender']) =>
    `${session.selfId}:${sender}:${nextMessageSequence++}`;

  const sendSignal = (signal: Signal) =>
    Ref.get(sessionTokenRef).pipe(
      Effect.flatMap((sessionToken) => client.SendSignal({ ...session, sessionToken, signal })),
    );

  const createAndSendOffer = Effect.fn('@tether/client-runtime/createAndSendOffer')(function* (
    peerConnection: PeerConnectionHandle,
  ) {
    const created = yield* platform.createOffer(peerConnection);
    const offer = yield* requireDescription(created, 'offer');
    yield* platform.setLocalDescription(peerConnection, offer);
    yield* sendSignal(new SessionDescriptionSignal(offer));
  });

  const acceptOfferAndSendAnswer = Effect.fn('@tether/client-runtime/acceptOfferAndSendAnswer')(
    function* (peerConnection: PeerConnectionHandle, signal: SessionDescriptionSignalType) {
      yield* platform.setRemoteDescription(peerConnection, {
        type: 'offer',
        sdp: signal.sdp,
      });

      const created = yield* platform.createAnswer(peerConnection);
      const answer = yield* requireDescription(created, 'answer');
      yield* platform.setLocalDescription(peerConnection, answer);
      yield* sendSignal(new SessionDescriptionSignal(answer));
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
        dataChannelState: { _tag: 'AwaitingRemoteDataChannel' },
        remoteAnswerApplied: false,
        reconnectAttempts: reconnectAttempts + 1,
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
    yield* createAndSendOffer(generation.peerConnection);
    state = {
      _tag: 'PeerKnown',
      generation,
      peerId,
      role,
      dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
      remoteAnswerApplied: false,
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
      CHAT_CHANNEL_LABEL,
    );

    yield* platform
      .observeDataChannel(dataChannel, dispatchLocalInput)
      .pipe(Scope.provide(generation.scope));

    yield* armNegotiationDeadline(generation);
    yield* createAndSendOffer(generation.peerConnection);

    state = {
      _tag: 'PeerKnown',
      generation,
      peerId,
      role: 'offerer',
      dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
      remoteAnswerApplied: false,
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
      role: 'answerer',
      dataChannelState: { _tag: 'AwaitingRemoteDataChannel' },
      remoteAnswerApplied: false,
      reconnectAttempts: 0,
    };
    yield* armNegotiationDeadline(generation);
  });

  const handleSignal = Effect.fnUntraced(function* (
    peerId: PeerId,
    signal: SessionDescriptionSignalType | IceCandidateSignal,
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
          yield* acceptOfferAndSendAnswer(state.generation.peerConnection, signal);
          return;
        }

        if (state.role !== 'offerer') {
          return yield* Effect.logWarning('Ignored answer received in invalid role');
        }
        if (state.remoteAnswerApplied) {
          return yield* Effect.logWarning('Ignored duplicate answer');
        }
        yield* platform.setRemoteDescription(state.generation.peerConnection, {
          type: 'answer',
          sdp: signal.sdp,
        });
        state = { ...state, remoteAnswerApplied: true };
        return;
      }
      case '@tether/IceCandidateSignal':
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
  });

  const handlePeerLeft = Effect.fnUntraced(function* (peerId: PeerId) {
    if (state._tag === 'TransportLost' && peerId === state.peerId) {
      const newGeneration = yield* acquirePeerConnectionGeneration();

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

    const currentGeneration = state.generation;

    yield* Scope.close(currentGeneration.scope, Exit.void);

    const newGeneration = yield* acquirePeerConnectionGeneration();

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
        yield* Ref.set(sessionTokenRef, event.sessionToken);
        return yield* handleRoomSessionOpened(event.peerId);
      }
      case '@tether/PeerJoinedEvent':
        return yield* handlePeerJoined(event.peerId);
      case '@tether/SignalReceivedEvent':
        return yield* handleSignal(event.peerId, event.signal);
      case '@tether/PeerLeftEvent':
        return yield* handlePeerLeft(event.peerId);
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
    candidate: IceCandidateSignal,
  ) {
    if (state._tag !== 'PeerKnown' || state.generation.peerConnection !== peerConnection) {
      return;
    }
    yield* sendSignal(candidate);
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

    if (state._tag === 'PeerKnown' && state.generation.peerConnection === peerConnection) {
      yield* Effect.logWarning('Peer connection failed');
      return yield* beginPeerReconnect();
    }

    if (state._tag === 'WaitingForPeer' && state.generation.peerConnection === peerConnection) {
      yield* Scope.close(state.generation.scope, Exit.void);

      const newGeneration = yield* acquirePeerConnectionGeneration();

      state = {
        _tag: 'WaitingForPeer',
        generation: newGeneration,
      };
    }
  });

  const handleDataChannelClosed = Effect.fnUntraced(function* (dataChannel: DataChannelHandle) {
    if (
      state._tag !== 'PeerKnown' ||
      state.dataChannelState._tag === 'AwaitingRemoteDataChannel' ||
      state.dataChannelState.dataChannel !== dataChannel
    ) {
      return;
    }

    yield* Effect.logWarning('Data channel closed');
    return yield* beginPeerReconnect();
  });

  const handlePeerConnectionInterrupted = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection ||
      state.dataChannelState._tag !== 'DataChannelOpen'
    ) {
      return;
    }

    yield* Effect.logWarning('Peer connection interrupted');
    yield* eventSink.emit({ _tag: 'PeerInterrupted', peerId: state.peerId });
  });

  const handlePeerConnectionRestored = Effect.fnUntraced(function* (
    peerConnection: PeerConnectionHandle,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.generation.peerConnection !== peerConnection ||
      state.dataChannelState._tag !== 'DataChannelOpen'
    ) {
      return;
    }

    yield* Effect.logInfo('Peer connection restored');
    yield* eventSink.emit({ _tag: 'PeerRestored', peerId: state.peerId });
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
      reconnectAttempts: 0,
    };
    yield* Effect.logInfo('Peer connection established');
    yield* eventSink.emit({ _tag: 'Connected', peerId: state.peerId });
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
      state.dataChannelState._tag === 'DataChannelOpen'
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

  return { handleInput, sessionTokenRef };
});

/**
 * Runs signaling, platform callbacks, and UI commands through one serialized
 * actor. The room stream owns the session lifetime, while a replaceable child
 * scope owns each peer-connection generation. Handle identity rejects stale
 * callbacks, and transport recovery replaces only the active generation.
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
 *          +-- SignalReceived(offer)
 *          |     - set remote offer
 *          |     - create and set local answer
 *          |     - SendSignal(answer)
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
 *          | - create and set local offer
 *          | - SendSignal(offer)
 *          v
 * [PeerKnown]
 *   role: offerer
 *   channel: DataChannelConnecting
 *          |
 *          | SignalReceived(answer)
 *          | - set remote answer
 *
 *
 * BOTH PATHS CONVERGE
 *
 * [PeerKnown + DataChannelConnecting]
 *          |
 *          | DataChannelOpened
 *          | - emit Connected(peerId)
 *          v
 * [PeerKnown + DataChannelOpen]
 *          |
 *          +-- DataChannelMessageReceived(text)
 *          |     - emit peer ChatMessageAdded
 *          |
 *          +-- SendMessage(text)
 *                - send over the data channel
 *                - emit self ChatMessageAdded
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
 *   OR DataChannelClosed(current owned channel)
 *   OR NegotiationDeadlineElapsed(mid-negotiation, retries remain)
 *          |
 *          | - close current generation
 *          | - acquire and observe a fresh generation
 *          | - emit PeerInterrupted(peerId)
 *          | - preserve role and increment reconnect attempts
 *          |
 *          +-- offerer: create a fresh channel and send a new offer
 *          |
 *          +-- answerer: await the peer's offer and remote channel
 *
 * DataChannelOpened resets the reconnect-attempt budget.
 *
 * PeerConnectionFailed OR DataChannelClosed after 2 attempts
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
 * LocalIceCandidate
 *   -> SendSignal(ice candidate)
 *
 * SignalReceived(active peer, ice candidate)
 *   -> platform.addIceCandidate(peer connection, candidate)
 * ```
 */
export interface PeerSession {
  /** Enqueues a chat command; `true` means queued, not remotely delivered. */
  readonly sendMessage: (message: string) => boolean;
  /** Explicitly releases room membership before the client tears down its transport. */
  readonly leave: () => Promise<void>;
}

export const startPeerSession = Effect.fn('@tether/client-runtime/startPeerSession')(function* (
  session: RoomSession,
) {
  const client = yield* AppClient;
  const { iceServers } = yield* client
    .GetIceServers()
    .pipe(
      Effect.catch(() =>
        Effect.logWarning('Falling back to default ICE servers').pipe(
          Effect.as({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] }),
        ),
      ),
    );
  const platform = yield* PeerSessionPlatform;
  const peerSessionEventSink = yield* PeerSessionEventSink;
  const sessionScope = yield* Scope.Scope;
  const mediaScope = yield* Scope.fork(sessionScope);
  const actorScope = yield* Scope.fork(sessionScope);
  const localInputQueue = yield* Queue.unbounded<PeerSessionLocalInput>();
  const dispatchLocalInput: PeerSessionLocalInputDispatch = (input) => {
    Queue.offerUnsafe(localInputQueue, input);
  };

  const roomInputStream = client.OpenRoomSession(session).pipe(
    Stream.map(
      ({ event }): PeerSessionInput => ({
        _tag: 'RoomEvent',
        event,
      }),
    ),
  );

  const localInputStream = Stream.fromQueue(localInputQueue);

  yield* peerSessionEventSink.emit({ _tag: 'SessionStarted' });

  // Local camera + microphone outlive individual connection generations but
  // are released as soon as the session actor reaches a terminal state.
  const localStream = yield* platform.acquireLocalMedia.pipe(Scope.provide(mediaScope));
  yield* peerSessionEventSink.emit({ _tag: 'LocalStreamReady', stream: localStream });

  const actor = yield* makePeerSessionActor(
    session,
    localStream,
    iceServers,
    dispatchLocalInput,
  ).pipe(Scope.provide(actorScope));

  const actorLoop = Stream.merge(roomInputStream, localInputStream, {
    haltStrategy: 'left',
  }).pipe(Stream.runForEach(actor.handleInput));

  yield* actorLoop.pipe(
    Effect.ensuring(Scope.close(actorScope, Exit.void)),
    Effect.ensuring(Queue.shutdown(localInputQueue)),
    Effect.onExit(
      Effect.fnUntraced(function* (exit) {
        yield* Scope.close(mediaScope, Exit.void);

        if (Exit.isSuccess(exit)) {
          yield* Effect.logInfo('Signaling stream ended');
          return yield* peerSessionEventSink.emit({ _tag: 'SignalingDisconnected' });
        }

        if (!Cause.hasInterruptsOnly(exit.cause)) {
          const maybeError = Cause.findErrorOption(exit.cause);

          if (Option.isSome(maybeError)) {
            const error = maybeError.value;

            if (isRoomFull(error)) {
              yield* Effect.logWarning('Room join rejected because room is full');
              return yield* peerSessionEventSink.emit({
                _tag: 'RoomJoinRejected',
                reason: 'room-full',
              });
            }

            if (isPeerAlreadyJoined(error)) {
              yield* Effect.logWarning(
                'Room join rejected because peer identity is already present',
              );
              return yield* peerSessionEventSink.emit({
                _tag: 'RoomJoinRejected',
                reason: 'peer-already-joined',
              });
            }

            if (isPeerNotInRoom(error)) {
              yield* Effect.logWarning('Signaling rejected because peer is no longer in room');
              return yield* peerSessionEventSink.emit({
                _tag: 'SignalingDisconnected',
              });
            }

            if (isPlatformError(error)) {
              yield* Effect.logError('Peer session failed during platform operation').pipe(
                Effect.annotateLogs('operation', error.operation),
              );
              return yield* peerSessionEventSink.emit({ _tag: 'SessionFailed' });
            }
          }

          yield* Effect.logError('Peer session failed');
          return yield* peerSessionEventSink.emit({ _tag: 'SessionFailed' });
        }
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );

  let leavePromise: Promise<void> | undefined;

  return {
    sendMessage: (message) =>
      Queue.offerUnsafe(localInputQueue, {
        _tag: 'SendMessage',
        message,
      }),
    leave: () => {
      leavePromise ??= Effect.runPromise(
        Ref.get(actor.sessionTokenRef).pipe(
          Effect.flatMap((sessionToken) => client.LeaveRoom({ ...session, sessionToken })),
        ),
      );
      return leavePromise;
    },
  } satisfies PeerSession;
});

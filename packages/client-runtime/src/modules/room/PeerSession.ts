import {
  isPeerAlreadyJoined,
  isPeerNotInRoom,
  isRoomFull,
  SessionDescriptionSignal,
  type IceCandidateSignal,
  type PeerId,
  type RoomEvent,
  type SessionDescriptionSignal as SessionDescriptionSignalType,
  type Signal,
} from '@tether/contracts/modules/room';
import { Cause, Duration, Effect, Exit, Option, Queue, Scope, Stream } from 'effect';

import { AppClient } from '../../AppClient';
import {
  CHAT_CHANNEL_LABEL,
  isPlatformError,
  type ChatMessage,
  type DataChannelHandle,
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
 * before the actor surfaces a stall. Chosen well above a healthy handshake
 * (typically < 5s) yet short enough to not feel indefinite.
 */
const NEGOTIATION_DEADLINE = Duration.seconds(20);

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
 * platform, and event-sink services. Inputs must be passed to the returned
 * handler serially; {@link startPeerSession} provides that serialization in
 * production, while tests can drive the handler directly.
 */
export const makePeerSessionActor = Effect.fn('@tether/client-runtime/makePeerSessionActor')(
  function* (session: RoomSession, dispatchLocalInput: PeerSessionLocalInputDispatch) {
    const client = yield* AppClient;
    const platform = yield* PeerSessionPlatform;
    const eventSink = yield* PeerSessionEventSink;
    const peerSessionScope = yield* Scope.Scope;
    let nextMessageSequence = 0;
    let state: PeerSessionActorState = {
      _tag: 'AwaitingRoomSession',
    };

    const makeMessageId = (sender: ChatMessage['sender']) =>
      `${session.selfId}:${sender}:${nextMessageSequence++}`;

    const sendSignal = (signal: Signal) => client.SendSignal({ ...session, signal });

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

    const acquirePeerConnectionGeneration = Effect.fn(
      '@tether/client-runtime/acquirePeerConnectionGeneration',
    )(function* () {
      const connectionScope = yield* Scope.fork(peerSessionScope);
      const peerConnection = yield* platform.acquirePeerConnection.pipe(
        Scope.provide(connectionScope),
      );
      yield* platform
        .observePeerConnection(peerConnection, dispatchLocalInput)
        .pipe(Scope.provide(connectionScope));

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

    const handleRoomSessionOpened = Effect.fn('@tether/client-runtime/handleRoomSessionOpened')(
      function* (peerId: PeerId | null) {
        if (state._tag !== 'AwaitingRoomSession') {
          return yield* Effect.logWarning(
            `Ignored duplicate room session open: room=${session.roomId} self=${session.selfId}`,
          );
        }

        const generation = yield* acquirePeerConnectionGeneration();

        if (peerId === null) {
          state = { _tag: 'WaitingForPeer', generation };
          yield* Effect.logInfo(
            `Room session opened; waiting for peer: room=${session.roomId} self=${session.selfId}`,
          );

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
        };
        yield* Effect.logInfo(
          `Room session opened as offerer; offer sent: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
        );
      },
    );

    const handlePeerJoined = Effect.fn('@tether/client-runtime/handlePeerJoined')(function* (
      peerId: PeerId,
    ) {
      if (state._tag !== 'WaitingForPeer') {
        return yield* Effect.logDebug(
          `Ignored peer join outside WaitingForPeer: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
        );
      }

      const { generation } = state;

      state = {
        _tag: 'PeerKnown',
        generation,
        peerId,
        role: 'answerer',
        dataChannelState: { _tag: 'AwaitingRemoteDataChannel' },
      };
      yield* Effect.logInfo(
        `Peer joined; acting as answerer: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
      );
      yield* armNegotiationDeadline(generation);
    });

    const handleSignal = Effect.fn('@tether/client-runtime/handleSignal')(function* (
      peerId: PeerId,
      signal: SessionDescriptionSignalType | IceCandidateSignal,
    ) {
      if (state._tag !== 'PeerKnown' || peerId !== state.peerId) {
        return yield* Effect.logDebug(
          `Ignored signal outside active pairing: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
        );
      }

      switch (signal._tag) {
        case '@tether/SessionDescriptionSignal': {
          if (signal.type === 'offer') {
            if (state.role !== 'answerer') {
              return yield* Effect.logWarning(
                `Ignored offer received as offerer: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
              );
            }
            yield* acceptOfferAndSendAnswer(state.generation.peerConnection, signal);
            yield* Effect.logInfo(
              `Offer accepted and answer sent: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
            );
            return;
          }

          if (state.role !== 'offerer') {
            return yield* Effect.logWarning(
              `Ignored answer received as answerer: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
            );
          }
          yield* platform.setRemoteDescription(state.generation.peerConnection, {
            type: 'answer',
            sdp: signal.sdp,
          });
          yield* Effect.logInfo(
            `Answer applied: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
          );
          return;
        }
        case '@tether/IceCandidateSignal':
          return yield* platform.addIceCandidate(state.generation.peerConnection, signal);
      }
    });

    const handlePeerLeft = Effect.fn('@tether/client-runtime/handlePeerLeft')(function* (
      peerId: PeerId,
    ) {
      if (state._tag === 'TransportLost' && peerId === state.peerId) {
        const newGeneration = yield* acquirePeerConnectionGeneration();

        state = {
          _tag: 'WaitingForPeer',
          generation: newGeneration,
        };

        yield* Effect.logInfo(
          `Peer departed after transport loss; waiting for replacement: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
        );
        return yield* eventSink.emit({ _tag: 'PeerDeparted', peerId });
      }

      if (state._tag !== 'PeerKnown' || peerId !== state.peerId) {
        return yield* Effect.logDebug(
          `Ignored departure outside active pairing: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
        );
      }

      const currentGeneration = state.generation;

      yield* Scope.close(currentGeneration.scope, Exit.void);

      const newGeneration = yield* acquirePeerConnectionGeneration();

      state = {
        _tag: 'WaitingForPeer',
        generation: newGeneration,
      };

      yield* Effect.logInfo(
        `Peer departed; waiting for replacement: room=${session.roomId} self=${session.selfId} peer=${peerId}`,
      );
      yield* eventSink.emit({ _tag: 'PeerDeparted', peerId });
    });

    const handleRoomEvent = Effect.fn('@tether/client-runtime/handleRoomEvent')(function* (
      event: RoomEvent,
    ) {
      switch (event._tag) {
        case '@tether/RoomSessionOpenedEvent':
          return yield* handleRoomSessionOpened(event.peerId);
        case '@tether/PeerJoinedEvent':
          return yield* handlePeerJoined(event.peerId);
        case '@tether/SignalReceivedEvent':
          return yield* handleSignal(event.peerId, event.signal);
        case '@tether/PeerLeftEvent':
          return yield* handlePeerLeft(event.peerId);
      }
    });

    const handleRemoteDataChannel = Effect.fn('@tether/client-runtime/handleRemoteDataChannel')(
      function* (peerConnection: PeerConnectionHandle, dataChannel: DataChannelHandle) {
        if (
          state._tag !== 'PeerKnown' ||
          state.generation.peerConnection !== peerConnection ||
          state.role !== 'answerer' ||
          state.dataChannelState._tag !== 'AwaitingRemoteDataChannel' ||
          platform.dataChannelLabel(dataChannel) !== CHAT_CHANNEL_LABEL
        ) {
          return yield* Effect.logDebug(
            `Ignored unexpected remote data channel: room=${session.roomId} self=${session.selfId}`,
          );
        }

        state = { ...state, dataChannelState: { _tag: 'DataChannelConnecting', dataChannel } };
        yield* platform
          .observeDataChannel(dataChannel, dispatchLocalInput)
          .pipe(Scope.provide(state.generation.scope));
        yield* Effect.logInfo(
          `Remote data channel accepted: room=${session.roomId} self=${session.selfId} peer=${state.peerId}`,
        );
      },
    );

    const handleLocalIceCandidate = Effect.fn('@tether/client-runtime/handleLocalIceCandidate')(
      function* (peerConnection: PeerConnectionHandle, candidate: IceCandidateSignal) {
        if (state._tag !== 'PeerKnown' || state.generation.peerConnection !== peerConnection) {
          return yield* Effect.logDebug(
            `Ignored local ICE candidate outside active pairing: room=${session.roomId} self=${session.selfId}`,
          );
        }
        yield* sendSignal(candidate);
      },
    );

    const handlePeerConnectionFailed = Effect.fn(
      '@tether/client-runtime/handlePeerConnectionFailed',
    )(function* (peerConnection: PeerConnectionHandle) {
      if (
        state._tag === 'AwaitingRoomSession' ||
        state._tag === 'TransportLost' ||
        state.generation.peerConnection !== peerConnection
      ) {
        return yield* Effect.logDebug(
          `Ignored failure from unowned peer connection: room=${session.roomId} self=${session.selfId}`,
        );
      }

      if (state._tag === 'PeerKnown' && state.generation.peerConnection === peerConnection) {
        yield* Scope.close(state.generation.scope, Exit.void);

        state = {
          _tag: 'TransportLost',
          peerId: state.peerId,
        };

        return yield* eventSink.emit({ _tag: 'TransportLost', peerId: state.peerId });
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

    const handleDataChannelClosed = Effect.fn('@tether/client-runtime/handleDataChannelClosed')(
      function* (dataChannel: DataChannelHandle) {
        if (
          state._tag !== 'PeerKnown' ||
          state.dataChannelState._tag === 'AwaitingRemoteDataChannel' ||
          state.dataChannelState.dataChannel !== dataChannel
        ) {
          return yield* Effect.logDebug(
            `Ignored close from unowned data channel: room=${session.roomId} self=${session.selfId}`,
          );
        }

        yield* Effect.logWarning(
          `Data channel closed: room=${session.roomId} self=${session.selfId}`,
        );

        yield* Scope.close(state.generation.scope, Exit.void);

        state = {
          _tag: 'TransportLost',
          peerId: state.peerId,
        };

        yield* eventSink.emit({ _tag: 'TransportLost', peerId: state.peerId });
      },
    );

    const handlePeerConnectionInterrupted = Effect.fn(
      '@tether/client-runtime/handlePeerConnectionInterrupted',
    )(function* (peerConnection: PeerConnectionHandle) {
      if (
        state._tag !== 'PeerKnown' ||
        state.generation.peerConnection !== peerConnection ||
        state.dataChannelState._tag !== 'DataChannelOpen'
      ) {
        return yield* Effect.logDebug(
          `Ignored interruption outside an open connection: room=${session.roomId} self=${session.selfId}`,
        );
      }

      yield* Effect.logWarning(
        `Peer connection interrupted: room=${session.roomId} self=${session.selfId} peer=${state.peerId}`,
      );
      yield* eventSink.emit({ _tag: 'PeerInterrupted', peerId: state.peerId });
    });

    const handlePeerConnectionRestored = Effect.fn(
      '@tether/client-runtime/handlePeerConnectionRestored',
    )(function* (peerConnection: PeerConnectionHandle) {
      if (
        state._tag !== 'PeerKnown' ||
        state.generation.peerConnection !== peerConnection ||
        state.dataChannelState._tag !== 'DataChannelOpen'
      ) {
        return yield* Effect.logDebug(
          `Ignored restoration outside an open connection: room=${session.roomId} self=${session.selfId}`,
        );
      }

      yield* Effect.logInfo(
        `Peer connection restored: room=${session.roomId} self=${session.selfId} peer=${state.peerId}`,
      );
      yield* eventSink.emit({ _tag: 'PeerRestored', peerId: state.peerId });
    });

    const handleDataChannelOpened = Effect.fn('@tether/client-runtime/handleDataChannelOpened')(
      function* (dataChannel: DataChannelHandle) {
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
          return yield* Effect.logDebug(
            `Ignored open from unowned data channel: room=${session.roomId} self=${session.selfId}`,
          );
        }

        state = { ...state, dataChannelState: { _tag: 'DataChannelOpen', dataChannel } };
        yield* Effect.logInfo(
          `Data channel opened: room=${session.roomId} self=${session.selfId} peer=${state.peerId}`,
        );
        yield* eventSink.emit({ _tag: 'Connected', peerId: state.peerId });
      },
    );

    const handleDataChannelMessage = Effect.fn('@tether/client-runtime/handleDataChannelMessage')(
      function* (dataChannel: DataChannelHandle, data: unknown) {
        if (
          state._tag !== 'PeerKnown' ||
          state.dataChannelState._tag !== 'DataChannelOpen' ||
          state.dataChannelState.dataChannel !== dataChannel
        ) {
          return yield* Effect.logDebug(
            `Ignored message from unowned data channel: room=${session.roomId} self=${session.selfId}`,
          );
        }
        if (typeof data !== 'string') {
          return yield* Effect.logWarning(
            `Ignored non-text chat payload: room=${session.roomId} self=${session.selfId}`,
          );
        }

        yield* eventSink.emit({
          _tag: 'ChatMessageAdded',
          message: { id: makeMessageId('peer'), sender: 'peer', text: data },
        });
      },
    );

    const handleNegotiationDeadlineElapsed = Effect.fn(
      '@tether/client-runtime/handleNegotiationDeadlineElapsed',
    )(function* (peerConnection: PeerConnectionHandle) {
      if (
        state._tag !== 'PeerKnown' ||
        state.generation.peerConnection !== peerConnection ||
        state.dataChannelState._tag === 'DataChannelOpen'
      ) {
        return yield* Effect.logDebug(
          `Ignored stale negotiation deadline: room=${session.roomId} self=${session.selfId}`,
        );
      }

      yield* Effect.logWarning(
        `Negotiation stalled: room=${session.roomId} self=${session.selfId} peer=${state.peerId}`,
      );
      yield* eventSink.emit({ _tag: 'NegotiationStalled', peerId: state.peerId });
    });

    const handleUiSendMessage = Effect.fn('@tether/client-runtime/handleUiSendMessage')(function* (
      text: string,
    ) {
      if (state._tag !== 'PeerKnown' || state.dataChannelState._tag !== 'DataChannelOpen') {
        return yield* Effect.logWarning(
          `Ignored send while data channel is not open: room=${session.roomId} self=${session.selfId}`,
        );
      }

      yield* platform.sendDataChannelMessage(state.dataChannelState.dataChannel, text);
      yield* eventSink.emit({
        _tag: 'ChatMessageAdded',
        message: { id: makeMessageId('self'), sender: 'self', text },
      });
    });

    return Effect.fn('@tether/client-runtime/handlePeerSessionInput')(function* (
      input: PeerSessionInput,
    ) {
      switch (input._tag) {
        case 'RoomEvent':
          return yield* handleRoomEvent(input.event);
        case 'RemoteDataChannel':
          return yield* handleRemoteDataChannel(input.peerConnection, input.dataChannel);
        case 'LocalIceCandidate':
          return yield* handleLocalIceCandidate(input.peerConnection, input.candidate);
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
  },
);

/**
 * Starts one platform-independent peer session in the surrounding scope and
 * returns its command interface.
 *
 * Three boundaries meet here:
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
 * ```
 *
 * The local queue converts callback-style platform events and synchronous UI
 * commands into a stream. Merging that stream with the signaling stream gives
 * the actor a single consumer, so state transitions never run concurrently.
 * The room stream is the lifetime authority: when it ends, `haltStrategy:
 * "left"` ends the merged stream even though the local queue is still open.
 *
 * The surrounding scope owns the actor fiber and one replaceable connection-
 * generation child scope. The child owns the peer connection plus its peer-
 * connection and data-channel listeners. Closing the session closes its current
 * child as well. The returned {@link PeerSession.sendMessage} only
 * reports whether the command was accepted by the local queue; delivery is
 * validated later by the actor against the current data-channel state.
 *
 * Invalid or stale inputs are logged and ignored rather than changing state:
 * this includes signals from another peer, role-inappropriate SDP, non-text
 * payloads, and events carrying an unowned connection or channel handle. A
 * duplicate open event for the owned channel is intentionally idempotent. When
 * the active peer leaves, the actor closes that generation, acquires a fresh
 * one, returns to `WaitingForPeer`, and emits `PeerDeparted`.
 * A failure from the current peer connection or the current owned data channel
 * terminates the actor immediately. Other RPC or platform failures also
 * terminate the scoped actor fiber.
 *
 * ```text
 * COMMON START
 *
 * [AwaitingRoomSession]
 *          |
 *          | RoomSessionOpened
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
 *          | SignalReceived(offer)
 *          | - set remote offer
 *          | - create and set local answer
 *          | - SendSignal(answer)
 *          | - state remains unchanged
 *          |
 *          | RemoteDataChannel
 *          | - require label = "chat"
 *          | - observe channel events
 *          v
 * [PeerKnown]
 *   role: answerer
 *   channel: DataChannelConnecting(owned channel)
 *
 *
 * OFFERER PATH (second peer joining the room)
 *
 * RoomSessionOpened(peerId = existing peer)
 *          |
 *          | - create local "chat" data channel
 *          | - observe channel events
 *          | - create and set local offer
 *          | - SendSignal(offer)
 *          v
 * [PeerKnown]
 *   role: offerer
 *   channel: DataChannelConnecting(owned channel)
 *          |
 *          | SignalReceived(answer)
 *          | - set remote answer
 *          | - state remains unchanged
 *
 *
 * BOTH PATHS CONVERGE
 *
 * [PeerKnown + DataChannelConnecting(owned channel)]
 *          |
 *          | DataChannelOpened(owned channel)
 *          | - emit Connected(peerId)
 *          v
 * [PeerKnown + DataChannelOpen(owned channel)]
 *          |
 *          +-- DataChannelMessageReceived(owned channel, text)
 *          |     - emit peer ChatMessageAdded
 *          |     - state remains open
 *          |
 *          +-- SendMessage(text)
 *          |     - platform sends text on the owned channel
 *          |     - emit self ChatMessageAdded
 *          |     - state remains open
 *          |
 *          +-- duplicate DataChannelOpened(owned channel)
 *                - ignore; state remains open
 *
 *
 * ACTIVE PEER DEPARTURE
 *
 * [PeerKnown + current generation]
 *          |
 *          | PeerLeft(active peer)
 *          | - close current generation scope
 *          |   - remove data-channel listeners
 *          |   - remove peer-connection listeners
 *          |   - close peer connection and its channels
 *          | - fork and acquire a fresh generation
 *          | - emit PeerDeparted(peerId)
 *          v
 * [WaitingForPeer + fresh generation]
 *          |
 *          | PeerJoined(nextPeerId)
 *          v
 * [PeerKnown]
 *   role: answerer
 *   channel: AwaitingRemoteDataChannel
 *
 * Queued callbacks from the closed generation carry its old opaque handle.
 * Connection/channel identity checks reject them after replacement.
 *
 *
 * TRANSPORT LOSS (generation-scoped, not session-scoped)
 *
 * PeerConnectionFailed(current generation while PeerKnown)
 *   OR DataChannelClosed(current owned channel)
 *          |
 *          | - close only the current generation scope
 *          | - emit TransportLost(peerId)
 *          v
 * [TransportLost(peerId) + signaling still alive]
 *          |
 *          | PeerLeft(same peer)
 *          | - acquire a fresh generation
 *          | - emit PeerDeparted
 *          v
 * [WaitingForPeer + fresh generation]
 *
 * PeerConnectionFailed(current generation while WaitingForPeer)
 *          |
 *          | - close the failed generation
 *          | - acquire a fresh generation
 *          v
 * [WaitingForPeer + fresh generation]
 *
 * The actor and signaling remain alive throughout: a lost WebRTC transport ends
 * only its generation, never the session. The same events carrying stale
 * generation/channel handles are ignored.
 *
 *
 * ICE EXCHANGE (independent while PeerKnown)
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
}

export const startPeerSession = Effect.fn('@tether/client-runtime/startPeerSession')(function* (
  session: RoomSession,
) {
  const client = yield* AppClient;
  const peerSessionEventSink = yield* PeerSessionEventSink;
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

  yield* Effect.logInfo(`Peer session started: room=${session.roomId} self=${session.selfId}`);
  yield* Effect.addFinalizer(() =>
    Effect.logInfo(`Peer session stopped: room=${session.roomId} self=${session.selfId}`),
  );
  yield* peerSessionEventSink.emit({ _tag: 'SessionStarted' });

  const actorLoop = Effect.gen(function* () {
    const inputHandler = yield* makePeerSessionActor(session, dispatchLocalInput);

    return yield* Stream.merge(roomInputStream, localInputStream, {
      haltStrategy: 'left',
    }).pipe(Stream.runForEach(inputHandler));
  });

  yield* Effect.scoped(actorLoop).pipe(
    Effect.ensuring(Queue.shutdown(localInputQueue)),
    Effect.onExit(
      Effect.fnUntraced(function* (exit) {
        if (Exit.isSuccess(exit)) {
          yield* Effect.logInfo(
            `Signaling stream ended: room=${session.roomId} self=${session.selfId}`,
          );
          return yield* peerSessionEventSink.emit({ _tag: 'SignalingDisconnected' });
        }

        if (!Cause.hasInterruptsOnly(exit.cause)) {
          const maybeError = Cause.findErrorOption(exit.cause);

          if (Option.isSome(maybeError)) {
            const error = maybeError.value;

            if (isRoomFull(error)) {
              yield* Effect.logWarning(
                `Room join rejected because room is full: room=${session.roomId} self=${session.selfId}`,
              );
              return yield* peerSessionEventSink.emit({
                _tag: 'RoomJoinRejected',
                reason: 'room-full',
              });
            }

            if (isPeerAlreadyJoined(error)) {
              yield* Effect.logWarning(
                `Room join rejected because peer identity is already present: room=${session.roomId} self=${session.selfId}`,
              );
              return yield* peerSessionEventSink.emit({
                _tag: 'RoomJoinRejected',
                reason: 'peer-already-joined',
              });
            }

            if (isPeerNotInRoom(error)) {
              yield* Effect.logWarning(
                `Signaling rejected because peer is no longer in room: room=${session.roomId} self=${session.selfId}`,
              );
              return yield* peerSessionEventSink.emit({
                _tag: 'SignalingDisconnected',
              });
            }

            if (isPlatformError(error)) {
              yield* Effect.logError(
                `Peer session failed during ${error.operation}: room=${session.roomId} self=${session.selfId}`,
                error.cause,
              );
              return yield* peerSessionEventSink.emit({ _tag: 'SessionFailed' });
            }
          }

          yield* Effect.logError(
            `Peer session failed: room=${session.roomId} self=${session.selfId}`,
            Cause.prettyErrors(exit.cause),
          );
          return yield* peerSessionEventSink.emit({ _tag: 'SessionFailed' });
        }
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );

  return {
    sendMessage: (message) =>
      Queue.offerUnsafe(localInputQueue, {
        _tag: 'SendMessage',
        message,
      }),
  } satisfies PeerSession;
});

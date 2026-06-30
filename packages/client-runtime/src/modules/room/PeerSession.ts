import {
  SessionDescriptionSignal,
  type IceCandidateSignal,
  type PeerId,
  type RoomEvent,
  type SessionDescriptionSignal as SessionDescriptionSignalType,
  type Signal,
} from '@tether/contracts/modules/room';
import { Effect, Queue, Stream } from 'effect';

import { AppClient } from '../../AppClient';
import {
  CHAT_CHANNEL_LABEL,
  type ChatMessage,
  type DataChannelHandle,
  type PeerConnectionHandle,
  type PeerSessionActorState,
  type PlatformCommand,
  type PlatformCommandDispatch,
  type RoomSession,
  type SessionDescription,
} from './PeerSessionModel';
import { PeerSessionEventSink, PeerSessionPlatform } from './PeerSessionServices';

type PeerSessionUiCommand = {
  readonly _tag: 'SendMessage';
  readonly message: string;
};

type PeerSessionLocalCommand = PlatformCommand | PeerSessionUiCommand;

type PeerSessionCommand =
  | {
      readonly _tag: 'RoomEvent';
      readonly event: RoomEvent;
    }
  | PeerSessionLocalCommand;

const requireDescription = (description: SessionDescription, type: 'offer' | 'answer') =>
  description.sdp === undefined
    ? Effect.fail(new Error(`Failed to create ${type}: SDP is undefined`))
    : Effect.succeed({ type, sdp: description.sdp } as const);

const unexpectedCommand = (message: string) =>
  Effect.logWarning(`Peer session ignored: ${message}`);

/**
 * Builds the stateful command handler for one peer session.
 *
 * The handler deliberately has no browser or React knowledge. It mutates one
 * private state value and interprets each command using the injected RPC,
 * platform, and event-sink services. Commands must be passed to the returned
 * handler serially; {@link startPeerSession} provides that serialization in
 * production, while tests can drive the handler directly.
 */
export const makePeerSessionActor = Effect.fn('@tether/client-runtime/makePeerSessionActor')(
  function* (session: RoomSession, dispatchPlatformCommand: PlatformCommandDispatch) {
    const client = yield* AppClient;
    const platform = yield* PeerSessionPlatform;
    const eventSink = yield* PeerSessionEventSink;
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

    const handleRoomSessionOpened = Effect.fn('@tether/client-runtime/handleRoomSessionOpened')(
      function* (peerId: PeerId | null) {
        if (state._tag !== 'AwaitingRoomSession') {
          return yield* unexpectedCommand('room session opened more than once');
        }

        const peerConnection = yield* platform.acquirePeerConnection;
        yield* platform.observePeerConnection(peerConnection, dispatchPlatformCommand);

        if (peerId === null) {
          state = { _tag: 'WaitingForPeer', peerConnection };
          return;
        }

        const dataChannel = yield* platform.createDataChannel(peerConnection, CHAT_CHANNEL_LABEL);
        yield* platform.observeDataChannel(dataChannel, dispatchPlatformCommand);
        yield* createAndSendOffer(peerConnection);

        state = {
          _tag: 'PeerKnown',
          peerConnection,
          peerId,
          role: 'offerer',
          dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
        };
      },
    );

    const handlePeerJoined = Effect.fn('@tether/client-runtime/handlePeerJoined')(function* (
      peerId: PeerId,
    ) {
      if (state._tag !== 'WaitingForPeer') {
        return yield* unexpectedCommand('peer joined outside WaitingForPeer');
      }

      state = {
        _tag: 'PeerKnown',
        peerConnection: state.peerConnection,
        peerId,
        role: 'answerer',
        dataChannelState: { _tag: 'AwaitingRemoteDataChannel' },
      };
    });

    const handleSignal = Effect.fn('@tether/client-runtime/handleSignal')(function* (
      peerId: PeerId,
      signal: SessionDescriptionSignalType | IceCandidateSignal,
    ) {
      if (state._tag !== 'PeerKnown' || peerId !== state.peerId) {
        return yield* unexpectedCommand('signal arrived before or from outside the active pairing');
      }

      switch (signal._tag) {
        case '@tether/SessionDescriptionSignal': {
          if (signal.type === 'offer') {
            if (state.role !== 'answerer') {
              return yield* unexpectedCommand('offer received by the offerer');
            }
            return yield* acceptOfferAndSendAnswer(state.peerConnection, signal);
          }

          if (state.role !== 'offerer') {
            return yield* unexpectedCommand('answer received by the answerer');
          }
          return yield* platform.setRemoteDescription(state.peerConnection, {
            type: 'answer',
            sdp: signal.sdp,
          });
        }
        case '@tether/IceCandidateSignal':
          return yield* platform.addIceCandidate(state.peerConnection, signal);
      }
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
          return yield* Effect.logInfo(`Peer left room: ${event.peerId}`);
      }
    });

    const handleRemoteDataChannel = Effect.fn('@tether/client-runtime/handleRemoteDataChannel')(
      function* (dataChannel: DataChannelHandle) {
        if (
          state._tag !== 'PeerKnown' ||
          state.role !== 'answerer' ||
          state.dataChannelState._tag !== 'AwaitingRemoteDataChannel' ||
          platform.dataChannelLabel(dataChannel) !== CHAT_CHANNEL_LABEL
        ) {
          return yield* unexpectedCommand('unexpected remote data channel');
        }

        state = { ...state, dataChannelState: { _tag: 'DataChannelConnecting', dataChannel } };
        yield* platform.observeDataChannel(dataChannel, dispatchPlatformCommand);
      },
    );

    const handleLocalIceCandidate = Effect.fn('@tether/client-runtime/handleLocalIceCandidate')(
      function* (candidate: IceCandidateSignal) {
        if (state._tag !== 'PeerKnown') {
          return yield* unexpectedCommand('local ICE candidate arrived before a peer was known');
        }
        yield* sendSignal(candidate);
      },
    );

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
          return yield* unexpectedCommand('open event came from an unowned data channel');
        }

        state = { ...state, dataChannelState: { _tag: 'DataChannelOpen', dataChannel } };
        yield* eventSink.emit({ _tag: 'Connected', peerId: state.peerId });
        yield* Effect.logInfo(`Chat data channel opened with peer ${state.peerId}`);
      },
    );

    const handleDataChannelMessage = Effect.fn('@tether/client-runtime/handleDataChannelMessage')(
      function* (dataChannel: DataChannelHandle, data: unknown) {
        if (
          state._tag !== 'PeerKnown' ||
          state.dataChannelState._tag !== 'DataChannelOpen' ||
          state.dataChannelState.dataChannel !== dataChannel
        ) {
          return yield* unexpectedCommand('message came from an unowned data channel');
        }
        if (typeof data !== 'string') {
          return yield* unexpectedCommand('non-text chat payload');
        }

        yield* eventSink.emit({
          _tag: 'ChatMessageAdded',
          message: { id: makeMessageId('peer'), sender: 'peer', text: data },
        });
      },
    );

    const handleUiSendMessage = Effect.fn('@tether/client-runtime/handleUiSendMessage')(function* (
      text: string,
    ) {
      if (state._tag !== 'PeerKnown' || state.dataChannelState._tag !== 'DataChannelOpen') {
        return yield* unexpectedCommand('UI send message on a non-open data channel');
      }

      yield* platform.sendDataChannelMessage(state.dataChannelState.dataChannel, text);
      yield* eventSink.emit({
        _tag: 'ChatMessageAdded',
        message: { id: makeMessageId('self'), sender: 'self', text },
      });
    });

    return Effect.fn('@tether/client-runtime/handlePeerSessionCommand')(function* (
      command: PeerSessionCommand,
    ) {
      switch (command._tag) {
        case 'RoomEvent':
          return yield* handleRoomEvent(command.event);
        case 'RemoteDataChannel':
          return yield* handleRemoteDataChannel(command.dataChannel);
        case 'LocalIceCandidate':
          return yield* handleLocalIceCandidate(command.candidate);
        case 'DataChannelOpened':
          return yield* handleDataChannelOpened(command.dataChannel);
        case 'DataChannelMessageReceived':
          return yield* handleDataChannelMessage(command.dataChannel, command.data);
        case 'SendMessage':
          return yield* handleUiSendMessage(command.message);
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
 * platform callback -> PlatformCommand -----+--> merged stream --> actor
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
 * The surrounding scope owns the actor fiber, peer connection, and installed
 * platform listeners. Closing that scope interrupts the stream and runs every
 * registered finalizer. The returned {@link PeerSession.sendMessage} only
 * reports whether the command was accepted by the local queue; delivery is
 * validated later by the actor against the current data-channel state.
 *
 * Invalid or stale commands are logged and ignored rather than changing state:
 * this includes signals from another peer, role-inappropriate SDP, non-text
 * payloads, and events from an unowned channel. A duplicate open event for the
 * owned channel is intentionally idempotent. `PeerLeftEvent` currently records
 * the departure only; reconnect/reset behavior has not been introduced yet.
 * Failures from RPC or platform operations are not recovered here and therefore
 * terminate the scoped actor fiber.
 *
 * ```text
 * COMMON START
 *
 * [AwaitingRoomSession]
 *          |
 *          | RoomSessionOpened
 *          | - acquire peer connection
 *          | - observe ICE and remote data-channel events
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
  const localCommandQueue = yield* Queue.unbounded<PeerSessionLocalCommand>();
  const dispatchPlatformCommand: PlatformCommandDispatch = (command) => {
    Queue.offerUnsafe(localCommandQueue, command);
  };
  const handleCommand = yield* makePeerSessionActor(session, dispatchPlatformCommand);

  yield* Effect.logInfo(`Peer session started: room=${session.roomId} self=${session.selfId}`);
  yield* Effect.addFinalizer(() =>
    Effect.logInfo(`Peer session stopped: room=${session.roomId} self=${session.selfId}`),
  );

  const roomCommandStream = client.OpenRoomSession(session).pipe(
    Stream.map(
      ({ event }): PeerSessionCommand => ({
        _tag: 'RoomEvent',
        event,
      }),
    ),
  );
  const localCommandStream = Stream.fromQueue(localCommandQueue);

  yield* Stream.merge(roomCommandStream, localCommandStream, {
    haltStrategy: 'left',
  }).pipe(Stream.runForEach(handleCommand), Effect.forkScoped({ startImmediately: true }));

  return {
    sendMessage: (message) =>
      Queue.offerUnsafe(localCommandQueue, {
        _tag: 'SendMessage',
        message,
      }),
  } satisfies PeerSession;
});

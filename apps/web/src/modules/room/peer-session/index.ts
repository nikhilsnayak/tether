import { AppClient } from '@tether/client-runtime';
import {
  IceCandidateSignal,
  SessionDescriptionSignal,
  type IceCandidateSignal as IceCandidateSignalType,
  type PeerId,
  type RoomEvent,
  type SessionDescriptionSignal as SessionDescriptionSignalType,
} from '@tether/contracts/modules/room';
import { Effect, Queue, Stream } from 'effect';
import { Atom } from 'effect/unstable/reactivity';

import type { RoomSession } from '../types';
import { peerSessionViewAtom } from './atoms';
import {
  CHAT_CHANNEL_LABEL,
  type BrowserCommand,
  type ChatMessage,
  type PeerConnectionActorState,
  type PeerConnectionCommand,
  type UiCommand,
} from './model';
import {
  acquirePeerConnection,
  createChatDataChannel,
  observeDataChannel,
  observePeerConnection,
} from './resources';

type AppClientService = AppClient['Service'];

interface ActorDependencies extends RoomSession {
  readonly client: AppClientService;
  readonly browserCommandQueue: Queue.Queue<BrowserCommand>;
}

const requireSdp = (description: RTCSessionDescriptionInit, kind: 'offer' | 'answer') =>
  description.sdp === undefined
    ? Effect.fail(new Error(`Failed to create ${kind}: SDP is undefined`))
    : Effect.succeed(description.sdp);

const sendSessionDescription = Effect.fn('@tether/web/sendSessionDescription')(function* (
  client: AppClientService,
  session: RoomSession,
  type: 'offer' | 'answer',
  sdp: string,
) {
  yield* client.SendSignal({
    ...session,
    signal: new SessionDescriptionSignal({ type, sdp }),
  });
});

const createAndSendOffer = Effect.fn('@tether/web/createAndSendOffer')(function* (
  client: AppClientService,
  session: RoomSession,
  peerConnection: RTCPeerConnection,
) {
  const offer = yield* Effect.tryPromise(() => peerConnection.createOffer());
  yield* Effect.tryPromise(() => peerConnection.setLocalDescription(offer));
  const sdp = yield* requireSdp(offer, 'offer');
  yield* sendSessionDescription(client, session, 'offer', sdp);
});

const acceptOfferAndSendAnswer = Effect.fn('@tether/web/acceptOfferAndSendAnswer')(function* (
  client: AppClientService,
  session: RoomSession,
  peerConnection: RTCPeerConnection,
  signal: SessionDescriptionSignalType,
) {
  yield* Effect.tryPromise(() =>
    peerConnection.setRemoteDescription({ type: 'offer', sdp: signal.sdp }),
  );

  const answer = yield* Effect.tryPromise(() => peerConnection.createAnswer());
  yield* Effect.tryPromise(() => peerConnection.setLocalDescription(answer));
  const sdp = yield* requireSdp(answer, 'answer');
  yield* sendSessionDescription(client, session, 'answer', sdp);
});

const acceptAnswer = (peerConnection: RTCPeerConnection, signal: SessionDescriptionSignalType) =>
  Effect.tryPromise(() => peerConnection.setRemoteDescription({ type: 'answer', sdp: signal.sdp }));

const applyRemoteIceCandidate = (
  peerConnection: RTCPeerConnection,
  signal: IceCandidateSignalType,
) =>
  Effect.tryPromise(() =>
    peerConnection.addIceCandidate({
      candidate: signal.candidate,
      sdpMid: signal.sdpMid,
      sdpMLineIndex: signal.sdpMLineIndex,
      usernameFragment: signal.usernameFragment,
    }),
  );

const sendLocalIceCandidate = Effect.fn('@tether/web/sendLocalIceCandidate')(function* (
  client: AppClientService,
  session: RoomSession,
  candidate: RTCIceCandidateInit,
) {
  yield* client.SendSignal({
    ...session,
    signal: new IceCandidateSignal({
      candidate: candidate.candidate ?? '',
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      usernameFragment: candidate.usernameFragment ?? null,
    }),
  });
});

const unexpectedCommand = (message: string) =>
  Effect.logWarning(`Peer session ignored: ${message}`);

/**
 * Creates the single command handler that owns mutable peer-session state.
 * `Stream.runForEach` invokes it sequentially, so no other fiber can mutate the
 * state or call WebRTC methods concurrently.
 */
const makePeerConnectionActor = ({
  client,
  roomId,
  selfId,
  browserCommandQueue,
}: ActorDependencies) => {
  const session = { roomId, selfId };
  let nextMessageSequence = 0;
  let state: PeerConnectionActorState = { _tag: 'AwaitingRoomSession' };

  const makeMessageId = (sender: ChatMessage['sender']) =>
    `${selfId}:${sender}:${nextMessageSequence++}`;

  const handleRoomSessionOpened = Effect.fn('@tether/web/handleRoomSessionOpened')(function* (
    peerId: PeerId | null,
  ) {
    if (state._tag !== 'AwaitingRoomSession') {
      return yield* unexpectedCommand('room session opened more than once');
    }

    const peerConnection = yield* acquirePeerConnection;
    yield* observePeerConnection(peerConnection, browserCommandQueue);

    if (peerId === null) {
      state = { _tag: 'WaitingForPeer', peerConnection };
      return;
    }

    const dataChannel = yield* createChatDataChannel(peerConnection);
    yield* observeDataChannel(dataChannel, browserCommandQueue);
    yield* createAndSendOffer(client, session, peerConnection);

    state = {
      _tag: 'PeerKnown',
      peerConnection,
      peerId,
      role: 'offerer',
      dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
    };
  });

  const handlePeerJoined = Effect.fn('@tether/web/handlePeerJoined')(function* (peerId: PeerId) {
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

  const handleSignal = Effect.fn('@tether/web/handleSignal')(function* (
    peerId: PeerId,
    signal: SessionDescriptionSignalType | IceCandidateSignalType,
  ) {
    if (state._tag !== 'PeerKnown' || peerId !== state.peerId) {
      return yield* unexpectedCommand('signal arrived before or from outside the active pairing');
    }

    const { peerConnection } = state;

    switch (signal._tag) {
      case '@tether/SessionDescriptionSignal': {
        if (signal.type === 'offer') {
          if (state.role !== 'answerer') {
            return yield* unexpectedCommand('offer received by the offerer');
          }
          return yield* acceptOfferAndSendAnswer(client, session, peerConnection, signal);
        }

        if (state.role !== 'offerer') {
          return yield* unexpectedCommand('answer received by the answerer');
        }
        return yield* acceptAnswer(peerConnection, signal);
      }
      case '@tether/IceCandidateSignal':
        return yield* applyRemoteIceCandidate(peerConnection, signal);
    }
  });

  const handleRoomEvent = Effect.fn('@tether/web/handleRoomEvent')(function* (event: RoomEvent) {
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

  const handleRemoteDataChannel = Effect.fn('@tether/web/handleRemoteDataChannel')(function* (
    dataChannel: RTCDataChannel,
  ) {
    if (
      state._tag !== 'PeerKnown' ||
      state.role !== 'answerer' ||
      state.dataChannelState._tag !== 'AwaitingRemoteDataChannel' ||
      dataChannel.label !== CHAT_CHANNEL_LABEL
    ) {
      return yield* unexpectedCommand('unexpected remote data channel');
    }

    state = { ...state, dataChannelState: { _tag: 'DataChannelConnecting', dataChannel } };
    yield* observeDataChannel(dataChannel, browserCommandQueue);
  });

  const handleLocalIceCandidate = Effect.fn('@tether/web/handleLocalIceCandidate')(function* (
    candidate: RTCIceCandidateInit,
  ) {
    if (state._tag !== 'PeerKnown') {
      return yield* unexpectedCommand('local ICE candidate arrived before a peer was known');
    }
    yield* sendLocalIceCandidate(client, session, candidate);
  });

  const handleDataChannelOpened = Effect.fn('@tether/web/handleDataChannelOpened')(function* (
    dataChannel: RTCDataChannel,
  ) {
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
    yield* Atom.update(peerSessionViewAtom, (view) => ({ ...view, status: 'connected' as const }));

    yield* Effect.logInfo(`Chat data channel opened with peer ${state.peerId}`);
  });

  const handleDataChannelMessage = Effect.fn('@tether/web/handleDataChannelMessage')(function* (
    dataChannel: RTCDataChannel,
    data: unknown,
  ) {
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
    const message: ChatMessage = {
      id: makeMessageId('peer'),
      sender: 'peer',
      text: data,
    };

    yield* Atom.update(peerSessionViewAtom, (view) => ({
      ...view,
      messages: [...view.messages, message],
    }));

    yield* Effect.logInfo(`Chat message from ${state.peerId}: ${data}`);
  });

  const handleUiSendMessage = Effect.fn('@tether/web/handleUiSendMessage')(function* (
    text: string,
  ) {
    if (state._tag !== 'PeerKnown' || state.dataChannelState._tag !== 'DataChannelOpen') {
      return yield* unexpectedCommand('UI send message on a non-open data channel');
    }
    const { dataChannel } = state.dataChannelState;

    yield* Effect.sync(() => dataChannel.send(text));

    const message: ChatMessage = {
      id: makeMessageId('self'),
      sender: 'self',
      text,
    };

    yield* Atom.update(peerSessionViewAtom, (view) => ({
      ...view,
      messages: [...view.messages, message],
    }));
  });

  return Effect.fn('@tether/web/handlePeerConnectionCommand')(function* (
    command: PeerConnectionCommand,
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
};

/**
 * Serializes room events, browser callbacks, and UI commands through one actor.
 * Browser callbacks only enqueue commands, preventing SDP and ICE operations
 * from overtaking one another.
 *
 * ```text
 *                                  AwaitingRoomSession
 *                                            |
 *                     RoomSessionOpenedEvent | acquire RTCPeerConnection
 *                                            | observe ICE + datachannel events
 *                         +------------------+------------------+
 *                         | peerId = null                       | peerId = existing peer
 *                         v                                     | create local "chat" channel
 *                   WaitingForPeer                              | observe channel events
 *                         |                                     | create + set local offer
 *         PeerJoinedEvent |                                     | SendSignal(offer)
 *                         |                                     v
 *                         |                         PeerKnown(role = offerer,
 *                         |                           channel = DataChannelConnecting)
 *                         |                                     |
 *                         |                SignalReceived(answer) | set remote answer
 *                         |                                     | (state unchanged)
 *                         v                                     |
 *             PeerKnown(role = answerer,                        |
 *               channel = AwaitingRemoteDataChannel)            |
 *                         |                                     |
 *   SignalReceived(offer) | set remote offer                    |
 *                         | create + set local answer           |
 *                         | SendSignal(answer)                  |
 *                         | (state unchanged)                   |
 *                         |                                     |
 *      RemoteDataChannel  | require label = "chat"              |
 *                         | observe channel events              |
 *                         v                                     |
 *             PeerKnown(role = answerer,                        |
 *               channel = DataChannelConnecting)                |
 *                         |                                     |
 *                         +------------------+------------------+
 *                                            |
 *                          DataChannelOpened | require owned channel
 *                                            | set view.status = connected
 *                                            v
 *                                PeerKnown(role unchanged,
 *                                  channel = DataChannelOpen)
 *                                            |
 *                 +--------------------------+--------------------------+
 *                 |                          |                          |
 *                 v                          v                          v
 * DataChannelMessageReceived        SendMessage UI command       duplicate open
 * validate text + owned channel     dataChannel.send(text)          ignored
 * append peer message to atom       append self message to atom         |
 *                 |                          |                          |
 *                 +--------------------------+--------------------------+
 *                                            |
 *                              state remains DataChannelOpen
 *
 * While PeerKnown, ICE is exchanged independently of role/channel state:
 *
 *   LocalIceCandidate ------------> SendSignal(ice candidate)
 *   SignalReceived(ice candidate) -> RTCPeerConnection.addIceCandidate(...)
 *
 * PeerLeftEvent is currently logged without changing actor or view state.
 * Commands invalid for the current state or peer are logged and ignored.
 * ```
 */
export const runPeerSession = Effect.fn('@tether/web/runPeerSession')(function* (
  session: RoomSession,
  uiCommandQueue: Queue.Queue<UiCommand>,
) {
  const client = yield* AppClient;
  const browserCommandQueue = yield* Queue.unbounded<BrowserCommand>();

  const handleCommand = makePeerConnectionActor({
    ...session,
    client,
    browserCommandQueue,
  });

  yield* Effect.logInfo(`Peer session started: room=${session.roomId} self=${session.selfId}`);
  yield* Effect.addFinalizer(() =>
    Effect.logInfo(`Peer session stopped: room=${session.roomId} self=${session.selfId}`),
  );

  const roomCommandStream = client.OpenRoomSession(session).pipe(
    Stream.map(
      ({ event }): PeerConnectionCommand => ({
        _tag: 'RoomEvent',
        event,
      }),
    ),
  );

  const browserCommandStream = Stream.fromQueue(browserCommandQueue);
  const uiCommandStream = Stream.fromQueue(uiCommandQueue);

  const localCommandStream = Stream.merge(uiCommandStream, browserCommandStream);

  yield* Stream.merge(roomCommandStream, localCommandStream, {
    haltStrategy: 'left',
  }).pipe(Stream.runForEach(handleCommand));
});

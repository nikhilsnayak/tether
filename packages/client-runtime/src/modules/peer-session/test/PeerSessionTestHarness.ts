import {
  DUSK_SUITE_TEMPLATE_ID,
  DisplayName,
  IceCandidateSignal,
  NoPendingJoin,
  PeerId,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomId,
  RoomSessionOpenedEvent,
  SessionDescriptionSignal,
  SessionToken,
  SignalReceivedEvent,
  type RoomEvent,
  type RoomTemplateId,
  type Signal,
} from '@tether/contracts/modules/room';
import { Effect, Layer, Queue, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import { AppSignalingClient } from '../../../AppSignalingClient';
import { webCrypto } from '../../../test/WebCrypto';
import { PeerSessionSignalingTransport } from '../../room/PeerSessionHost';
import type { WatchCapabilities, WatchEvent } from '../../watch-along/Model';
import { WatchAlongPlatform, WatchEventSink } from '../../watch-along/Services';
import type { PeerSessionInput } from '../ActorModel';
import {
  type DataChannelHandle,
  type IceServer,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PeerSessionEvent,
  type PlatformEvent,
  type PlatformEventDispatch,
  type RoomSession,
} from '../Model';
import { makePeerSessionActor } from '../PeerSession';
import { type AvatarPose, type MediaState, ROOM_EVENTS_CHANNEL_LABEL } from '../RoomEvents';
import { PeerSessionEventSink, PeerSessionPlatform, PeerSessionSignaling } from '../Services';
import { WATCH_CONTROL_CHANNEL_LABEL } from '../WatchTransport';

interface TestPeerConnection {
  readonly id: string;
}

export interface TestDataChannel {
  readonly label: string;
}

export const session: Extract<RoomSession, { readonly intent: 'join' }> = {
  intent: 'join',
  roomId: RoomId.make('abc-defg-hij'),
  selfId: PeerId.make('aaaaaaaaaaaa'),
  displayName: DisplayName.make('tester'),
};
export const bob = PeerId.make('bbbbbbbbbbbb');
export const bobName = DisplayName.make('Bob');
export const charlie = PeerId.make('cccccccccccc');
export const mallory = PeerId.make('mmmmmmmmmmmm');
export const testSessionToken = SessionToken.make('test-session-token');
export const openedEvent = (
  peerId: PeerId | null,
  roomTemplateId: RoomTemplateId = DUSK_SUITE_TEMPLATE_ID,
) =>
  new RoomSessionOpenedEvent({
    peerId,
    sessionToken: testSessionToken,
    roomId: session.roomId,
    roomTemplateId,
  });

// Every RoomSessionOpenedEvent makes the actor surface the minted roomId first.
export const roomOpened: PeerSessionEvent = {
  _tag: 'RoomOpened',
  roomId: session.roomId,
  roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
};

export const makePeerSessionTestHarness = Effect.fn('makePeerSessionTestHarness')(function* (
  openRoomSession: AppSignalingClient['Service']['OpenRoomSession'] = (() =>
    Stream.empty) as AppSignalingClient['Service']['OpenRoomSession'],
  sendSignal?: AppSignalingClient['Service']['SendSignal'],
  overrides?: Partial<PeerSessionPlatform['Service']>,
  respondToJoinError?: NoPendingJoin | PeerNotInRoom,
  sendReadyToDetach?: (negotiationEpoch: number) => Effect.Effect<void, unknown>,
  watchOverrides?: {
    readonly role?: 'host' | 'guest';
    readonly capabilities?: Partial<WatchCapabilities>;
    readonly platform?: Partial<WatchAlongPlatform['Service']>;
    readonly sink?: WatchEventSink['Service'];
  },
) {
  const peerConnections: Array<PeerConnectionHandle> = [];
  let nextPeerConnection = 0;
  const makePeerConnection = (): PeerConnectionHandle => {
    const peerConnection: PeerConnectionHandle = {
      value: { id: `peer-connection-${peerConnections.length}` } satisfies TestPeerConnection,
    };
    peerConnections.push(peerConnection);
    return peerConnection;
  };
  const peerConnection = makePeerConnection();
  const dataChannels: Array<DataChannelHandle> = [];
  let nextDataChannel = 0;
  const makeDataChannel = (label: string): DataChannelHandle => {
    const dataChannel: DataChannelHandle = {
      value: { label } satisfies TestDataChannel,
    };
    dataChannels.push(dataChannel);
    return dataChannel;
  };
  const localDataChannel = makeDataChannel(ROOM_EVENTS_CHANNEL_LABEL);
  const localMediaStream: MediaStreamHandle = { value: { id: 'local-media' } };
  const operations: Array<string> = [];
  const signals: Array<Signal> = [];
  const sentSessionTokens: Array<string> = [];
  const readinessEpochs: Array<number> = [];
  const respondToJoinPayloads: Array<{
    readonly roomId: RoomId;
    readonly selfId: PeerId;
    readonly sessionToken: string;
    readonly peerId: PeerId;
    readonly decision: 'allow' | 'deny';
  }> = [];
  const events: Array<PeerSessionEvent> = [];
  const eventQueue = yield* Queue.unbounded<PeerSessionEvent>();
  const acquiredIceServers: Array<ReadonlyArray<IceServer>> = [];
  let platformEventDispatch: PlatformEventDispatch | undefined;
  const watchEvents: Array<WatchEvent> = [];
  const localInputs: Array<Extract<PeerSessionInput, { readonly _tag: 'WatchRuntimeTerminated' }>> =
    [];

  const basePlatform: PeerSessionPlatform['Service'] = {
    acquirePeerConnection: (iceServers) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          acquiredIceServers.push(iceServers);
          operations.push('acquirePeerConnection');
          return peerConnections[nextPeerConnection++] ?? makePeerConnection();
        }),
        () => Effect.sync(() => operations.push('closePeerConnection')),
      ),
    acquireLocalMedia: Effect.acquireRelease(
      Effect.sync(() => {
        operations.push('acquireLocalMedia');
        return localMediaStream;
      }),
      () => Effect.sync(() => operations.push('releaseLocalMedia')),
    ),
    observePeerConnection: (_, dispatch) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          platformEventDispatch = dispatch;
          operations.push('observePeerConnection');
        }),
        () => Effect.sync(() => operations.push('unobservePeerConnection')),
      ),
    addLocalTracks: () => Effect.sync(() => operations.push('addLocalTracks')),
    reserveProgramTransceivers: () =>
      Effect.sync(() => {
        operations.push('reserveProgramTransceivers');
        return { value: {} };
      }),
    activateProgramTransceivers: () => Effect.void,
    replaceProgramTracks: (_, stream) =>
      Effect.sync(() => {
        operations.push(`replaceProgramTracks:${stream === null ? 'clear' : 'set'}`);
      }),
    createDataChannel: (_, label) =>
      Effect.sync(() => {
        operations.push(`createDataChannel:${label}`);
        return dataChannels[nextDataChannel++] ?? makeDataChannel(label);
      }),
    observeDataChannel: (dataChannel) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          operations.push(`observeDataChannel:${(dataChannel.value as TestDataChannel).label}`),
        ),
        () =>
          Effect.sync(() =>
            operations.push(`unobserveDataChannel:${(dataChannel.value as TestDataChannel).label}`),
          ),
      ),
    dataChannelLabel: (dataChannel) => (dataChannel.value as TestDataChannel).label,
    dataChannelBufferedAmount: () => 0,
    closeDataChannel: (dataChannel) =>
      Effect.sync(() =>
        operations.push(`closeDataChannel:${(dataChannel.value as TestDataChannel).label}`),
      ),
    createOffer: () =>
      Effect.sync(() => {
        operations.push('createOffer');
        return { type: 'offer', sdp: 'offer-sdp' };
      }),
    createAnswer: () =>
      Effect.sync(() => {
        operations.push('createAnswer');
        return { type: 'answer', sdp: 'answer-sdp' };
      }),
    setLocalDescription: (_, description) =>
      Effect.sync(() =>
        operations.push(`setLocalDescription:${description.type}:${description.sdp}`),
      ),
    setRemoteDescription: (_, description) =>
      Effect.sync(() =>
        operations.push(`setRemoteDescription:${description.type}:${description.sdp}`),
      ),
    addIceCandidate: (_, candidate) =>
      Effect.sync(() => operations.push(`addIceCandidate:${candidate.candidate}`)),
    sendDataChannelMessage: (_, message) =>
      Effect.sync(() => operations.push(`sendDataChannelMessage:${message}`)),
  };
  const platform = PeerSessionPlatform.of({ ...basePlatform, ...overrides });
  const watchCapabilities: WatchCapabilities = {
    canPresentLocalFile: true,
    canReceiveProgramMedia: true,
    canRenderWatch: true,
    canControlWatch: true,
  };
  const baseWatchPlatform: WatchAlongPlatform['Service'] = {
    cancelPreparedSource: () => Effect.sync(() => operations.push('watch:cancelPreparedSource')),
    claimSource: () =>
      Effect.acquireRelease(Effect.succeed({ value: { id: 'watch-claimed-source' } }), () =>
        Effect.sync(() => operations.push('watch:releaseSource')),
      ),
    programStream: () => Effect.succeed({ value: { id: 'watch-program-stream' } }),
    play: () => Effect.sync(() => operations.push('watch:play')),
    pause: () => Effect.sync(() => operations.push('watch:pause')),
    seek: () => Effect.sync(() => operations.push('watch:seek')),
    observeSource: () => Effect.void,
    primeFirstFrame: () => Effect.void,
    attachProgramTracks: () => Effect.void,
    clearProgramTracks: Effect.void,
  };
  const watchPlatform = WatchAlongPlatform.of({
    ...baseWatchPlatform,
    ...watchOverrides?.platform,
  });
  const watchEventSink =
    watchOverrides?.sink ??
    WatchEventSink.of({
      emit: (event) => Effect.sync(() => void watchEvents.push(event)),
    });
  const respondToJoin = ((payload: Parameters<AppSignalingClient['Service']['RespondToJoin']>[0]) =>
    Effect.sync(() => {
      respondToJoinPayloads.push(payload);
      operations.push(`respondToJoin:${payload.decision}`);
    }).pipe(
      Effect.andThen(
        respondToJoinError === undefined ? Effect.void : Effect.fail(respondToJoinError),
      ),
    )) as AppSignalingClient['Service']['RespondToJoin'];

  const signaling = PeerSessionSignaling.of({
    sendSignal: (signal) => {
      sentSessionTokens.push(testSessionToken);
      const wireSignal =
        signal._tag === 'SessionDescription'
          ? new SessionDescriptionSignal({
              type: signal.type,
              sdp: signal.sdp,
              negotiationEpoch: signal.negotiationEpoch,
            })
          : new IceCandidateSignal({
              candidate: signal.candidate,
              sdpMid: signal.sdpMid,
              sdpMLineIndex: signal.sdpMLineIndex,
              usernameFragment: signal.usernameFragment,
              negotiationEpoch: signal.negotiationEpoch,
            });
      return sendSignal !== undefined
        ? sendSignal({
            selfId: session.selfId,
            roomId: session.roomId,
            sessionToken: testSessionToken,
            signal: wireSignal,
          })
        : Effect.sync(() => {
            signals.push(wireSignal);
            operations.push(
              wireSignal._tag === '@tether/SessionDescriptionSignal'
                ? `sendSignal:${wireSignal.type}:${wireSignal.sdp}`
                : `sendSignal:ice:${wireSignal.candidate}`,
            );
          });
    },
    sendReadyToDetach: (negotiationEpoch) =>
      sendReadyToDetach !== undefined
        ? sendReadyToDetach(negotiationEpoch)
        : Effect.sync(() => {
            readinessEpochs.push(negotiationEpoch);
            operations.push(`readyToDetach:${negotiationEpoch}`);
          }),
  });

  const appSignalingClient = AppSignalingClient.of({
    LeaveRoom: () =>
      Effect.sync(() => {
        operations.push('leaveRoom');
      }),
    ReadyToDetach: () => Effect.void,
    RespondToJoin: respondToJoin,
    OpenRoomSession: openRoomSession,
    SendSignal: (payload) => {
      sentSessionTokens.push(payload.sessionToken);
      return sendSignal !== undefined
        ? sendSignal(payload)
        : Effect.sync(() => {
            const { signal } = payload;
            signals.push(signal);
            operations.push(
              signal._tag === '@tether/SessionDescriptionSignal'
                ? `sendSignal:${signal.type}:${signal.sdp}`
                : `sendSignal:ice:${signal.candidate}`,
            );
          });
    },
  });

  const dependencies = Layer.mergeAll(
    webCrypto,
    Layer.succeed(PeerSessionPlatform, platform),
    Layer.succeed(PeerSessionSignalingTransport, {
      acquire: Effect.succeed(appSignalingClient),
    }),
    Layer.succeed(
      PeerSessionEventSink,
      PeerSessionEventSink.of({
        emit: (event) =>
          Effect.gen(function* () {
            events.push(event);
            yield* Queue.offer(eventQueue, event);
          }),
      }),
    ),
    Layer.succeed(PeerSessionSignaling, signaling),
  );

  const peerActor = yield* makePeerSessionActor(
    session.selfId,
    localMediaStream,
    [],
    (input) => {
      if (input._tag === 'WatchRuntimeTerminated') localInputs.push(input);
    },
    {
      role: watchOverrides?.role ?? 'guest',
      capabilities: { ...watchCapabilities, ...watchOverrides?.capabilities },
      platform: watchPlatform,
      sink: watchEventSink,
    },
  ).pipe(Effect.provide(dependencies));

  const actor = (
    input: PeerSessionInput | { readonly _tag: 'RoomEvent'; readonly event: RoomEvent },
  ): Effect.Effect<unknown, unknown, Scope.Scope> => {
    if (input._tag === 'RoomEvent') {
      const { event } = input;
      switch (event._tag) {
        case '@tether/RoomSessionOpenedEvent':
          return Effect.gen(function* () {
            const opened: PeerSessionEvent = {
              _tag: 'RoomOpened',
              roomId: event.roomId,
              roomTemplateId: event.roomTemplateId,
            };
            events.push(opened);
            yield* Queue.offer(eventQueue, opened);
            yield* peerActor.handleInput({
              _tag: 'RoomSessionOpened',
              peerId: event.peerId,
              roomTemplateId: event.roomTemplateId,
            });
          });
        case '@tether/PeerJoinedEvent':
          return peerActor.handleInput({ _tag: 'PeerJoined', peerId: event.peerId });
        case '@tether/PeerLeftEvent':
          return peerActor.handleInput({ _tag: 'PeerLeft', peerId: event.peerId });
        case '@tether/SignalReceivedEvent':
          return peerActor.handleInput({
            _tag: 'SignalReceived',
            peerId: event.peerId,
            signal:
              event.signal._tag === '@tether/SessionDescriptionSignal'
                ? {
                    _tag: 'SessionDescription',
                    type: event.signal.type,
                    sdp: event.signal.sdp,
                    negotiationEpoch: event.signal.negotiationEpoch,
                  }
                : {
                    _tag: 'IceCandidate',
                    candidate: event.signal.candidate,
                    sdpMid: event.signal.sdpMid,
                    sdpMLineIndex: event.signal.sdpMLineIndex,
                    usernameFragment: event.signal.usernameFragment,
                    negotiationEpoch: event.signal.negotiationEpoch,
                  },
          });
        case '@tether/JoinRequestedEvent':
          return Effect.gen(function* () {
            const output = {
              _tag: 'JoinRequestReceived' as const,
              peerId: event.peerId,
              displayName: event.displayName,
            };
            events.push(output);
            yield* Queue.offer(eventQueue, output);
          });
        case '@tether/JoinPendingEvent':
          return Effect.gen(function* () {
            const output = { _tag: 'JoinPending' as const };
            events.push(output);
            yield* Queue.offer(eventQueue, output);
          });
        case '@tether/JoinCancelledEvent':
          return Effect.gen(function* () {
            const output = { _tag: 'JoinRequestCancelled' as const, peerId: event.peerId };
            events.push(output);
            yield* Queue.offer(eventQueue, output);
          });
        case '@tether/DetachedEvent':
          return peerActor.handleInput({ _tag: 'Detached' });
      }
    }
    return peerActor.handleInput(input);
  };

  const roomEvent = Effect.fn('PeerSessionTestHarness.roomEvent')((event: RoomEvent) =>
    actor({ _tag: 'RoomEvent', event }),
  );
  const openRoom = Effect.fn('PeerSessionTestHarness.openRoom')(
    (peerId: PeerId | null, roomTemplateId?: RoomTemplateId) =>
      roomEvent(openedEvent(peerId, roomTemplateId)),
  );
  const peerJoined = Effect.fn('PeerSessionTestHarness.peerJoined')((peerId: PeerId) =>
    roomEvent(new PeerJoinedEvent({ peerId })),
  );
  const peerLeft = Effect.fn('PeerSessionTestHarness.peerLeft')((peerId: PeerId) =>
    roomEvent(new PeerLeftEvent({ peerId })),
  );
  const receiveOffer = Effect.fn('PeerSessionTestHarness.receiveOffer')(
    (peerId: PeerId, sdp: string, negotiationEpoch: number) =>
      roomEvent(
        new SignalReceivedEvent({
          peerId,
          signal: new SessionDescriptionSignal({
            type: 'offer',
            sdp,
            negotiationEpoch,
          }),
        }),
      ),
  );
  const receiveAnswer = Effect.fn('PeerSessionTestHarness.receiveAnswer')(
    (peerId: PeerId, sdp: string, negotiationEpoch: number) =>
      roomEvent(
        new SignalReceivedEvent({
          peerId,
          signal: new SessionDescriptionSignal({
            type: 'answer',
            sdp,
            negotiationEpoch,
          }),
        }),
      ),
  );
  const receiveIce = Effect.fn('PeerSessionTestHarness.receiveIce')(
    (
      peerId: PeerId,
      candidate: {
        readonly candidate: string;
        readonly sdpMid: string | null;
        readonly sdpMLineIndex: number | null;
        readonly usernameFragment: string | null;
      },
      negotiationEpoch: number,
    ) =>
      roomEvent(
        new SignalReceivedEvent({
          peerId,
          signal: new IceCandidateSignal({
            ...candidate,
            negotiationEpoch,
          }),
        }),
      ),
  );
  const connectionConnected = Effect.fn('PeerSessionTestHarness.connectionConnected')(
    (connection: PeerConnectionHandle = peerConnection) =>
      actor({ _tag: 'PeerConnectionConnected', peerConnection: connection }),
  );
  const gatheringComplete = Effect.fn('PeerSessionTestHarness.gatheringComplete')(
    (connection: PeerConnectionHandle = peerConnection) =>
      actor({ _tag: 'IceGatheringComplete', peerConnection: connection }),
  );
  const connectionFailed = Effect.fn('PeerSessionTestHarness.connectionFailed')(
    (connection: PeerConnectionHandle = peerConnection) =>
      actor({ _tag: 'PeerConnectionFailed', peerConnection: connection }),
  );
  const connectionInterrupted = Effect.fn('PeerSessionTestHarness.connectionInterrupted')(
    (connection: PeerConnectionHandle = peerConnection) =>
      actor({ _tag: 'PeerConnectionInterrupted', peerConnection: connection }),
  );
  const connectionRestored = Effect.fn('PeerSessionTestHarness.connectionRestored')(
    (connection: PeerConnectionHandle = peerConnection) =>
      actor({ _tag: 'PeerConnectionRestored', peerConnection: connection }),
  );
  const openRoomEvents = Effect.fn('PeerSessionTestHarness.openRoomEvents')(
    (dataChannel: DataChannelHandle = localDataChannel) =>
      actor({ _tag: 'DataChannelOpened', dataChannel }),
  );
  const closeRoomEvents = Effect.fn('PeerSessionTestHarness.closeRoomEvents')(
    (dataChannel: DataChannelHandle = localDataChannel) =>
      actor({ _tag: 'DataChannelClosed', dataChannel }),
  );
  const watchChannel = () => {
    const channels = dataChannels.filter(
      (candidate) => (candidate.value as TestDataChannel).label === WATCH_CONTROL_CHANNEL_LABEL,
    );
    const channel = channels[channels.length - 1];
    if (channel === undefined) throw new Error('Watch channel has not been provisioned');
    return channel;
  };
  const openWatchChannel = Effect.fn('PeerSessionTestHarness.openWatchChannel')(() =>
    actor({ _tag: 'DataChannelOpened', dataChannel: watchChannel() }),
  );
  const receiveWatchMessage = Effect.fn('PeerSessionTestHarness.receiveWatchMessage')(
    (message: unknown) =>
      actor({
        _tag: 'DataChannelMessageReceived',
        dataChannel: watchChannel(),
        data: typeof message === 'string' ? message : JSON.stringify(message),
      }),
  );
  const closeWatchChannel = Effect.fn('PeerSessionTestHarness.closeWatchChannel')(() =>
    actor({ _tag: 'DataChannelClosed', dataChannel: watchChannel() }),
  );
  const sendChat = Effect.fn('PeerSessionTestHarness.sendChat')((message: string) =>
    actor({ _tag: 'SendMessage', message }),
  );
  const sendPose = Effect.fn('PeerSessionTestHarness.sendPose')((pose: AvatarPose) =>
    actor({ _tag: 'SendAvatarPose', pose }),
  );
  const sendMediaState = Effect.fn('PeerSessionTestHarness.sendMediaState')(
    (mediaState: MediaState) => actor({ _tag: 'SendMediaState', mediaState }),
  );
  const receiveDetachProbe = Effect.fn('PeerSessionTestHarness.receiveDetachProbe')(
    (dataChannel: DataChannelHandle = localDataChannel) =>
      actor({
        _tag: 'DataChannelMessageReceived',
        dataChannel,
        data: JSON.stringify({ version: 1, type: 'detach-probe' }),
      }),
  );
  const receiveLeave = Effect.fn('PeerSessionTestHarness.receiveLeave')(
    (dataChannel: DataChannelHandle = localDataChannel) =>
      actor({
        _tag: 'DataChannelMessageReceived',
        dataChannel,
        data: JSON.stringify({ version: 1, type: 'leave' }),
      }),
  );
  const detached = Effect.fn('PeerSessionTestHarness.detached')(() => actor({ _tag: 'Detached' }));
  const sendLeave = Effect.fn('PeerSessionTestHarness.sendLeave')(() =>
    actor({ _tag: 'SendLeave' }),
  );
  const signalingEnded = Effect.fn('PeerSessionTestHarness.signalingEnded')(() =>
    actor({ _tag: 'SignalingEnded' }),
  );
  const advance = Effect.fn('PeerSessionTestHarness.advance')(
    (duration: Parameters<typeof TestClock.adjust>[0]) => TestClock.adjust(duration),
  );

  return {
    acquiredIceServers,
    actor,
    advance,
    closeRoomEvents,
    closeWatchChannel,
    connectionConnected,
    connectionFailed,
    connectionInterrupted,
    connectionRestored,
    dataChannels,
    detached,
    dependencies,
    dispatchPlatformEvent: (event: PlatformEvent) => {
      if (platformEventDispatch === undefined) {
        throw new Error('Peer connection is not being observed');
      }
      platformEventDispatch(event);
    },
    eventQueue,
    events,
    gatheringComplete,
    localDataChannel,
    localInputs,
    localMediaStream,
    openRoom,
    openRoomEvents,
    openWatchChannel,
    operationOrder: () => operations.slice(),
    operations,
    peerJoined,
    peerLeft,
    peerConnection,
    peerConnections,
    readinessEpochs,
    respondToJoinPayloads,
    receiveAnswer,
    receiveDetachProbe,
    receiveIce,
    receiveLeave,
    receiveOffer,
    receiveWatchMessage,
    sendChat,
    sendLeave,
    sendMediaState,
    sendPose,
    sentSessionTokens,
    signals,
    signalingEnded,
    watchChannel,
    watchEvents,
  };
});

import { assert, describe, it } from '@effect/vitest';
import {
  DUSK_SUITE_TEMPLATE_ID,
  DisplayName,
  IceCandidateSignal,
  JoinCancelledEvent,
  JoinDenied,
  JoinPendingEvent,
  JoinRequestedEvent,
  NoPendingJoin,
  PeerAlreadyJoined,
  PeerId,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomId,
  RoomFull,
  RoomNotFound,
  RoomSessionOpenedEvent,
  ServerAtCapacity,
  SessionDescriptionSignal,
  SessionToken,
  SignalReceivedEvent,
  type RoomEvent,
  type Signal,
} from '@tether/contracts/modules/room';
import { Crypto, Deferred, Effect, Exit, Layer, Queue, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import { AppClient } from '../../AppClient';
import { startPeerSession } from '../room/PeerSessionHost';
import {
  type DataChannelHandle,
  type IceServer,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PeerSessionEvent,
  type PlatformEvent,
  type PlatformEventDispatch,
  type RoomSession,
} from './Model';
import { makePeerSessionActor } from './PeerSession';
import { PlatformError } from './Platform';
import { PeerSessionEventSink, PeerSessionPlatform, PeerSessionSignaling } from './Services';
import { initialPeerSessionView, reducePeerSessionView } from './View';

interface TestPeerConnection {
  readonly id: string;
}

interface TestDataChannel {
  readonly label: string;
}

// No DOM lib in this tsconfig, so the Web Crypto global is typed by hand.
const webCryptoApi = (
  globalThis as unknown as {
    readonly crypto: {
      readonly getRandomValues: <T extends Uint8Array>(array: T) => T;
      readonly subtle: {
        readonly digest: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;
      };
    };
  }
).crypto;

const webCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => webCryptoApi.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.promise(async () => new Uint8Array(await webCryptoApi.subtle.digest(algorithm, data))),
  }),
);

const session: RoomSession = {
  intent: 'join',
  roomId: RoomId.make('abc-defg-hij'),
  selfId: PeerId.make('aaaaaaaaaaaa'),
  displayName: DisplayName.make('tester'),
};
const bob = PeerId.make('bbbbbbbbbbbb');
const bobName = DisplayName.make('Bob');
const charlie = PeerId.make('cccccccccccc');
const mallory = PeerId.make('mmmmmmmmmmmm');
const testSessionToken = SessionToken.make('test-session-token');
const openedEvent = (peerId: PeerId | null) =>
  new RoomSessionOpenedEvent({
    peerId,
    sessionToken: testSessionToken,
    roomId: session.roomId,
    roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
  });

// Every RoomSessionOpenedEvent makes the actor surface the minted roomId first.
const roomOpened: PeerSessionEvent = {
  _tag: 'RoomOpened',
  roomId: session.roomId,
  roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
};

const makeFixture = Effect.fn('makeFixture')(function* (
  openRoomSession: AppClient['Service']['OpenRoomSession'] = (() =>
    Stream.empty) as AppClient['Service']['OpenRoomSession'],
  sendSignal?: AppClient['Service']['SendSignal'],
  overrides?: Partial<PeerSessionPlatform['Service']>,
  respondToJoinError?: NoPendingJoin | PeerNotInRoom,
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
  const localDataChannel = makeDataChannel('chat');
  const localMediaStream: MediaStreamHandle = { value: { id: 'local-media' } };
  const operations: Array<string> = [];
  const signals: Array<Signal> = [];
  const sentSessionTokens: Array<string> = [];
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
  const respondToJoin = ((payload: Parameters<AppClient['Service']['RespondToJoin']>[0]) =>
    Effect.sync(() => {
      respondToJoinPayloads.push(payload);
      operations.push(`respondToJoin:${payload.decision}`);
    }).pipe(
      Effect.andThen(
        respondToJoinError === undefined ? Effect.void : Effect.fail(respondToJoinError),
      ),
    )) as AppClient['Service']['RespondToJoin'];

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
  });

  const dependencies = Layer.mergeAll(
    webCrypto,
    Layer.succeed(PeerSessionPlatform, platform),
    Layer.succeed(
      AppClient,
      AppClient.of({
        GetRoomMetadata: (() =>
          Effect.succeed({
            roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
          })) as AppClient['Service']['GetRoomMetadata'],
        LeaveRoom: () =>
          Effect.sync(() => {
            operations.push('leaveRoom');
          }),
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
      }),
    ),
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
    () => {},
  ).pipe(Effect.provide(dependencies));

  const actor = (input: unknown): Effect.Effect<void, unknown, Scope.Scope> => {
    if (
      typeof input === 'object' &&
      input !== null &&
      '_tag' in input &&
      input._tag === 'RoomEvent'
    ) {
      const event = (input as unknown as { readonly event: RoomEvent }).event;
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
            yield* peerActor.handleInput({ _tag: 'RoomSessionOpened', peerId: event.peerId });
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
      }
    }
    return peerActor.handleInput(input as never) as Effect.Effect<void, unknown, Scope.Scope>;
  };

  return {
    acquiredIceServers,
    actor,
    dataChannels,
    dependencies,
    dispatchPlatformEvent: (event: PlatformEvent) => {
      if (platformEventDispatch === undefined) {
        throw new Error('Peer connection is not being observed');
      }
      platformEventDispatch(event);
    },
    eventQueue,
    events,
    localDataChannel,
    localMediaStream,
    operations,
    peerConnection,
    peerConnections,
    respondToJoinPayloads,
    sentSessionTokens,
    signals,
  };
});

describe('startPeerSession', () => {
  it.effect('uses the Google public STUN server for peer connection acquisition', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const offerSent = yield* Deferred.make<void>();
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          ({ signal }) =>
            signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer'
              ? Deferred.succeed(offerSent, undefined)
              : Effect.void,
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        yield* Deferred.await(offerSent);

        assert.deepStrictEqual(fixture.acquiredIceServers, [
          [{ urls: ['stun:stun.l.google.com:19302'] }],
        ]);
      }),
    ),
  );

  it.effect('echoes the opened session token in signaling calls', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const offerSent = yield* Deferred.make<void>();
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          ({ signal }) =>
            signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer'
              ? Deferred.succeed(offerSent, undefined)
              : Effect.void,
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        yield* Deferred.await(offerSent);

        assert.deepStrictEqual(fixture.sentSessionTokens, [testSessionToken]);
      }),
    ),
  );

  it.effect('acquires local media and emits LocalStreamReady on session start', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));

        const localStreamReady = fixture.events.filter(
          (event) => event._tag === 'LocalStreamReady',
        );
        assert.deepStrictEqual(localStreamReady, [
          { _tag: 'LocalStreamReady', stream: fixture.localMediaStream },
        ]);
      }),
    ),
  );

  it.effect('explicitly leaves the room at most once', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.make({
            event: openedEvent(null),
          }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession']);
        const peerSession = yield* startPeerSession(session).pipe(
          Effect.provide(fixture.dependencies),
        );

        // Wait until the room is open so the actor has learned its roomId; only
        // then does leaving issue a LeaveRoom call.
        yield* Queue.take(fixture.eventQueue);
        yield* Queue.take(fixture.eventQueue);
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);

        yield* Effect.promise(() => Promise.all([peerSession.leave(), peerSession.leave()]));

        assert.lengthOf(
          fixture.operations.filter((operation) => operation === 'leaveRoom'),
          1,
        );
      }),
    ),
  );

  it.effect('resolves an early leave without waiting for the room to open', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const roomEventQueue = yield* Queue.unbounded<{ readonly event: RoomEvent }>();
        const fixture = yield* makeFixture((() =>
          Stream.fromQueue(roomEventQueue)) as AppClient['Service']['OpenRoomSession']);
        const peerSession = yield* startPeerSession(session).pipe(
          Effect.provide(fixture.dependencies),
        );

        const leavePromise = peerSession.leave();

        assert.notInclude(fixture.operations, 'leaveRoom');

        yield* Effect.promise(() => leavePromise);

        assert.notInclude(fixture.operations, 'leaveRoom');
      }),
    ),
  );

  it.effect('emits WaitingForPeer when the room opens without another peer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.make({
            event: openedEvent(null),
          })) as AppClient['Service']['OpenRoomSession']);

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));

        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'SessionStarted');
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'WaitingForPeer',
        });
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'SignalingDisconnected',
        });
      }),
    ),
  );

  it.effect('disconnects and rejects new commands when the room stream ends normally', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        const peerSession = yield* startPeerSession(session).pipe(
          Effect.provide(fixture.dependencies),
        );
        const started = yield* Queue.take(fixture.eventQueue);
        const localStream = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.strictEqual(localStream._tag, 'LocalStreamReady');
        assert.deepStrictEqual(event, { _tag: 'SignalingDisconnected' });
        assert.isFalse(peerSession.sendMessage('too late'));
      }),
    ),
  );

  it.effect('emits RoomJoinRejected when the room is full', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.fail(
            new RoomFull({ roomId: session.roomId }),
          )) as AppClient['Service']['OpenRoomSession']);

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        const started = yield* Queue.take(fixture.eventQueue);
        const localStream = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.strictEqual(localStream._tag, 'LocalStreamReady');
        assert.deepStrictEqual(event, {
          _tag: 'RoomJoinRejected',
          reason: 'room-full',
        });
      }),
    ),
  );

  it.effect('releases local media before the room-full session scope closes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.fail(
            new RoomFull({ roomId: session.roomId }),
          )) as AppClient['Service']['OpenRoomSession']);

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        yield* Queue.take(fixture.eventQueue);
        yield* Queue.take(fixture.eventQueue);
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'RoomJoinRejected',
          reason: 'room-full',
        });

        assert.include(fixture.operations, 'releaseLocalMedia');
      }),
    ),
  );

  it.effect('emits RoomJoinRejected when the server is at capacity', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.fail(new ServerAtCapacity())) as AppClient['Service']['OpenRoomSession']);

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        const started = yield* Queue.take(fixture.eventQueue);
        const localStream = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.strictEqual(localStream._tag, 'LocalStreamReady');
        assert.deepStrictEqual(event, {
          _tag: 'RoomJoinRejected',
          reason: 'server-at-capacity',
        });
      }),
    ),
  );

  it.effect('releases local media exactly once during normal scope teardown', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const fixture = yield* makeFixture(
        (() => Stream.never) as AppClient['Service']['OpenRoomSession'],
      ).pipe(Scope.provide(scope));

      yield* startPeerSession(session).pipe(
        Effect.provide(fixture.dependencies),
        Scope.provide(scope),
      );
      yield* Queue.take(fixture.eventQueue);
      yield* Queue.take(fixture.eventQueue);

      assert.notInclude(fixture.operations, 'releaseLocalMedia');
      yield* Scope.close(scope, Exit.void);
      assert.lengthOf(
        fixture.operations.filter((operation) => operation === 'releaseLocalMedia'),
        1,
      );
    }),
  );

  it.effect('emits RoomJoinRejected when the peer identity is already present', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.fail(
            new PeerAlreadyJoined({
              roomId: session.roomId,
              peerId: session.selfId,
            }),
          )) as AppClient['Service']['OpenRoomSession']);

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        const started = yield* Queue.take(fixture.eventQueue);
        const localStream = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.strictEqual(localStream._tag, 'LocalStreamReady');
        assert.deepStrictEqual(event, {
          _tag: 'RoomJoinRejected',
          reason: 'peer-already-joined',
        });
      }),
    ),
  );

  it.effect('emits RoomJoinRejected when the room does not exist', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.fail(
            new RoomNotFound({ roomId: session.roomId }),
          )) as AppClient['Service']['OpenRoomSession']);

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        const started = yield* Queue.take(fixture.eventQueue);
        const localStream = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.strictEqual(localStream._tag, 'LocalStreamReady');
        assert.deepStrictEqual(event, {
          _tag: 'RoomJoinRejected',
          reason: 'room-not-found',
        });
      }),
    ),
  );

  it.effect('emits RoomJoinRejected when the host declines the join', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.fail(new JoinDenied())) as AppClient['Service']['OpenRoomSession']);

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        const started = yield* Queue.take(fixture.eventQueue);
        const localStream = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.strictEqual(localStream._tag, 'LocalStreamReady');
        assert.deepStrictEqual(event, {
          _tag: 'RoomJoinRejected',
          reason: 'join-denied',
        });
      }),
    ),
  );

  it.effect('sends the host decision for a knocking joiner over RespondToJoin', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.make({
            event: openedEvent(null),
          }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession']);
        const peerSession = yield* startPeerSession(session).pipe(
          Effect.provide(fixture.dependencies),
        );

        // Wait until the room is open so the actor has learned its roomId + token.
        yield* Queue.take(fixture.eventQueue);
        yield* Queue.take(fixture.eventQueue);
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);

        yield* Effect.promise(() => peerSession.respondToJoin(bob, 'allow'));
        yield* Effect.promise(() => peerSession.respondToJoin(charlie, 'deny'));

        assert.deepStrictEqual(fixture.respondToJoinPayloads, [
          {
            roomId: session.roomId,
            selfId: session.selfId,
            sessionToken: testSessionToken,
            peerId: bob,
            decision: 'allow',
          },
          {
            roomId: session.roomId,
            selfId: session.selfId,
            sessionToken: testSessionToken,
            peerId: charlie,
            decision: 'deny',
          },
        ]);
        assert.includeMembers(fixture.operations, ['respondToJoin:allow', 'respondToJoin:deny']);
        assert.includeDeepMembers(fixture.events, [
          { _tag: 'JoinRequestHandled', peerId: bob },
          { _tag: 'JoinRequestHandled', peerId: charlie },
        ]);
      }),
    ),
  );

  it.effect('defers an early host decision until the room opens', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const roomEventQueue = yield* Queue.unbounded<{ readonly event: RoomEvent }>();
        const fixture = yield* makeFixture((() =>
          Stream.fromQueue(roomEventQueue)) as AppClient['Service']['OpenRoomSession']);
        const peerSession = yield* startPeerSession(session).pipe(
          Effect.provide(fixture.dependencies),
        );

        const responsePromise = peerSession.respondToJoin(bob, 'deny');

        assert.isEmpty(fixture.respondToJoinPayloads);
        assert.notIncludeDeepMembers(fixture.events, [{ _tag: 'JoinRequestHandled', peerId: bob }]);

        yield* Queue.offer(roomEventQueue, { event: openedEvent(null) });
        yield* Effect.promise(() => responsePromise);

        assert.deepStrictEqual(fixture.respondToJoinPayloads, [
          {
            roomId: session.roomId,
            selfId: session.selfId,
            sessionToken: testSessionToken,
            peerId: bob,
            decision: 'deny',
          },
        ]);
        assert.includeDeepMembers(fixture.events, [{ _tag: 'JoinRequestHandled', peerId: bob }]);
      }),
    ),
  );

  it.effect('suppresses only a stale join decision and marks its request handled', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: openedEvent(null),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          undefined,
          undefined,
          new NoPendingJoin({ roomId: session.roomId, peerId: bob }),
        );
        const peerSession = yield* startPeerSession(session).pipe(
          Effect.provide(fixture.dependencies),
        );

        yield* Queue.take(fixture.eventQueue);
        yield* Queue.take(fixture.eventQueue);
        yield* Queue.take(fixture.eventQueue);
        yield* Effect.promise(() => peerSession.respondToJoin(bob, 'deny'));

        assert.includeDeepMembers(fixture.events, [{ _tag: 'JoinRequestHandled', peerId: bob }]);
      }),
    ),
  );

  it.effect('rejects a join decision when its RPC fails for another reason', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: openedEvent(null),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          undefined,
          undefined,
          new PeerNotInRoom({ roomId: session.roomId, peerId: session.selfId }),
        );
        const peerSession = yield* startPeerSession(session).pipe(
          Effect.provide(fixture.dependencies),
        );

        yield* Queue.take(fixture.eventQueue);
        yield* Queue.take(fixture.eventQueue);
        yield* Queue.take(fixture.eventQueue);
        const rejection = yield* Effect.tryPromise({
          try: () => peerSession.respondToJoin(bob, 'allow'),
          catch: (cause) => cause,
        }).pipe(Effect.flip);

        assert.instanceOf(rejection, PeerNotInRoom);
        assert.notIncludeDeepMembers(fixture.events, [{ _tag: 'JoinRequestHandled', peerId: bob }]);
      }),
    ),
  );

  it.effect('emits SessionFailed when the signaling stream fails unexpectedly', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.fail(
            new Error('signaling failed'),
          )) as unknown as AppClient['Service']['OpenRoomSession']);

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'SessionStarted');
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'SessionFailed',
        });
      }),
    ),
  );

  it.effect('emits SessionFailed when a platform operation fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          undefined,
          {
            createOffer: () =>
              Effect.fail(new PlatformError({ operation: 'create-offer', cause: 'failed' })),
          },
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'SessionStarted');
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'SessionFailed',
        });
      }),
    ),
  );

  it.effect('emits SignalingDisconnected when SendSignal finds no room membership', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          (() =>
            Effect.fail(
              new PeerNotInRoom({ roomId: session.roomId, peerId: session.selfId }),
            )) as AppClient['Service']['SendSignal'],
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        const started = yield* Queue.take(fixture.eventQueue);
        const localStream = yield* Queue.take(fixture.eventQueue);
        const opened = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.strictEqual(localStream._tag, 'LocalStreamReady');
        assert.deepStrictEqual(opened, roomOpened);
        assert.deepStrictEqual(event, { _tag: 'SignalingDisconnected' });
      }),
    ),
  );

  it.effect('processes PeerLeft after chat becomes unavailable', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const roomEventQueue = yield* Queue.unbounded<{ readonly event: RoomEvent }>();
        const offerSent = yield* Deferred.make<void>();
        const fixture = yield* makeFixture(
          (() => Stream.fromQueue(roomEventQueue)) as AppClient['Service']['OpenRoomSession'],
          ({ signal }) =>
            Effect.gen(function* () {
              if (signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer') {
                yield* Deferred.succeed(offerSent, undefined);
              }
            }),
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'SessionStarted',
        });
        assert.strictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');

        yield* Queue.offer(roomEventQueue, {
          event: openedEvent(bob),
        });
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);
        yield* Deferred.await(offerSent);

        fixture.dispatchPlatformEvent({
          _tag: 'DataChannelClosed',
          dataChannel: fixture.localDataChannel,
        });
        yield* Effect.yieldNow;
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'ChatUnavailable',
        });

        yield* Queue.offer(roomEventQueue, {
          event: new PeerLeftEvent({ peerId: bob }),
        });

        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'PeerDeparted',
          peerId: bob,
        });
      }),
    ),
  );

  it.effect('reconnects when the initial negotiation stalls', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const roomEventQueue = yield* Queue.unbounded<{ readonly event: RoomEvent }>();
        const offerSent = yield* Deferred.make<void>();
        const fixture = yield* makeFixture(
          (() => Stream.fromQueue(roomEventQueue)) as AppClient['Service']['OpenRoomSession'],
          ({ signal }) =>
            Effect.gen(function* () {
              if (signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer') {
                yield* Deferred.succeed(offerSent, undefined);
              }
            }),
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'SessionStarted',
        });
        assert.strictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');

        yield* Queue.offer(roomEventQueue, {
          event: openedEvent(bob),
        });
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);
        // The peer never answers, so the remote description is never set, ICE
        // never starts, and the browser never reaches either 'connected' or
        // 'failed'. Only a negotiation deadline can initiate recovery.
        yield* Deferred.await(offerSent);

        yield* TestClock.adjust('20 seconds');

        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'PeerInterrupted',
          peerId: bob,
        });
      }),
    ),
  );

  it.effect('does not stall once the peer connection succeeds before the deadline', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const roomEventQueue = yield* Queue.unbounded<{ readonly event: RoomEvent }>();
        const offerSent = yield* Deferred.make<void>();
        const fixture = yield* makeFixture(
          (() => Stream.fromQueue(roomEventQueue)) as AppClient['Service']['OpenRoomSession'],
          ({ signal }) =>
            Effect.gen(function* () {
              if (signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer') {
                yield* Deferred.succeed(offerSent, undefined);
              }
            }),
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'SessionStarted',
        });
        assert.strictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');

        yield* Queue.offer(roomEventQueue, {
          event: openedEvent(bob),
        });
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);
        yield* Deferred.await(offerSent);

        fixture.dispatchPlatformEvent({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'Connected',
          peerId: bob,
        });

        // The deadline is never cancelled; it still fires but the handler drops
        // it because the peer connection is already established.
        yield* TestClock.adjust('20 seconds');
        yield* Effect.yieldNow;

        const stalled = fixture.events.filter((event) => event._tag === 'NegotiationStalled');
        assert.deepStrictEqual(stalled, []);
      }),
    ),
  );

  it.effect('emits SessionFailed when a created offer carries no SDP', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          undefined,
          { createOffer: () => Effect.succeed({ type: 'offer', sdp: undefined }) },
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'SessionStarted');
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), { _tag: 'SessionFailed' });
      }),
    ),
  );

  it.effect('emits SessionFailed when the actor loop dies with a defect', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          undefined,
          { addLocalTracks: () => Effect.die('boom') },
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'SessionStarted');
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), { _tag: 'SessionFailed' });
      }),
    ),
  );
});

describe('peer-session actor', () => {
  const fingerprintSdp = (fingerprint: string) =>
    ['v=0', `a=fingerprint:sha-256 ${fingerprint}`, ''].join('\r\n');
  const remoteOfferSdp = fingerprintSdp('AA:BB:CC:DD');
  const localAnswerSdp = fingerprintSdp('11:22:33:44');

  it.effect('surfaces a knock to the host and clears it when the joiner withdraws', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new JoinRequestedEvent({ peerId: bob, displayName: bobName }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new JoinCancelledEvent({ peerId: bob }),
        });

        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'WaitingForPeer' },
          { _tag: 'JoinRequestReceived', peerId: bob, displayName: bobName },
          { _tag: 'JoinRequestCancelled', peerId: bob },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('answerer and offerer derive the same safety code from the same handshake', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const answererFixture = yield* makeFixture(undefined, undefined, {
          createAnswer: () => Effect.succeed({ type: 'answer', sdp: localAnswerSdp }),
        });

        yield* answererFixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* answererFixture.actor({
          _tag: 'RoomEvent',
          event: new PeerJoinedEvent({ peerId: bob }),
        });
        yield* answererFixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'offer',
              sdp: remoteOfferSdp,
            }),
          }),
        });
        assert.lengthOf(
          answererFixture.events.filter((event) => event._tag === 'SasReady'),
          0,
        );
        yield* answererFixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: answererFixture.peerConnection,
        });

        const offererFixture = yield* makeFixture(undefined, undefined, {
          createOffer: () => Effect.succeed({ type: 'offer', sdp: remoteOfferSdp }),
        });

        yield* offererFixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* offererFixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: localAnswerSdp,
            }),
          }),
        });
        assert.lengthOf(
          offererFixture.events.filter((event) => event._tag === 'SasReady'),
          0,
        );
        yield* offererFixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: offererFixture.peerConnection,
        });

        const sasCodes = (events: ReadonlyArray<PeerSessionEvent>) =>
          events.flatMap((event) => (event._tag === 'SasReady' ? [event.code] : []));
        const answererCodes = sasCodes(answererFixture.events);
        const offererCodes = sasCodes(offererFixture.events);

        assert.lengthOf(answererCodes, 1);
        assert.match(answererCodes[0] ?? '', /^\d{5}( \d{5}){4}$/);
        assert.deepStrictEqual(offererCodes, answererCodes);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('skips the safety code when a description carries no fingerprint', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: 'remote-answer',
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });

        assert.include(fixture.operations, 'setRemoteDescription:answer:remote-answer');
        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'SasReady'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('drops a failed ICE candidate and continues processing signals', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(undefined, undefined, {
          addIceCandidate: () =>
            Effect.fail(new PlatformError({ operation: 'add-ice-candidate', cause: 'boom' })),
        });
        const remoteIce = new IceCandidateSignal({
          negotiationEpoch: 0,
          candidate: 'invalid-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        });

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({ peerId: bob, signal: remoteIce }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: 'remote-answer',
            }),
          }),
        });

        assert.include(fixture.operations, 'setRemoteDescription:answer:remote-answer');
        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'SessionFailed'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a duplicate answer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const answer = new SignalReceivedEvent({
          peerId: bob,
          signal: new SessionDescriptionSignal({
            negotiationEpoch: 0,
            type: 'answer',
            sdp: 'remote-answer',
          }),
        });

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: answer });
        yield* fixture.actor({ _tag: 'RoomEvent', event: answer });

        assert.lengthOf(
          fixture.operations.filter(
            (operation) => operation === 'setRemoteDescription:answer:remote-answer',
          ),
          1,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('reconnects the offerer after a peer connection failure', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnection,
        });

        assert.lengthOf(
          fixture.operations.filter((operation) => operation === 'acquirePeerConnection'),
          2,
        );
        assert.lengthOf(
          fixture.operations.filter((operation) => operation === 'createDataChannel:chat'),
          2,
        );
        assert.lengthOf(
          fixture.signals.filter(
            (signal) =>
              signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer',
          ),
          2,
        );
        assert.include(fixture.operations, 'closePeerConnection');
        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'Connected', peerId: bob },
          { _tag: 'PeerInterrupted', peerId: bob },
        ]);
        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'TransportLost'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('reconnects the answerer without creating an offer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnection,
        });

        assert.lengthOf(
          fixture.operations.filter((operation) => operation === 'acquirePeerConnection'),
          2,
        );
        assert.lengthOf(
          fixture.operations.filter((operation) => operation === 'createDataChannel:chat'),
          0,
        );
        assert.lengthOf(fixture.signals, 0);
        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'WaitingForPeer' },
          { _tag: 'Connected', peerId: bob },
          { _tag: 'PeerInterrupted', peerId: bob },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('emits TransportLost after reconnect attempts are exhausted', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[0]!,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[1]!,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[2]!,
        });

        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'PeerInterrupted', peerId: bob },
          { _tag: 'PeerInterrupted', peerId: bob },
          { _tag: 'TransportLost', peerId: bob },
        ]);
        assert.lengthOf(
          fixture.operations.filter((operation) => operation === 'acquirePeerConnection'),
          3,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('refills the reconnect budget after the replacement connection succeeds', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnections[0]!,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[0]!,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnections[1]!,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[1]!,
        });

        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'Connected', peerId: bob },
          { _tag: 'PeerInterrupted', peerId: bob },
          { _tag: 'Connected', peerId: bob },
          { _tag: 'PeerInterrupted', peerId: bob },
        ]);
        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'TransportLost'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('rejects a delayed old answer and accepts the current answer after reconnecting', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: 'initial-answer',
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[0]!,
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: 'delayed-old-answer',
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 1,
              type: 'answer',
              sdp: 'reconnect-answer',
            }),
          }),
        });

        assert.notInclude(fixture.operations, 'setRemoteDescription:answer:delayed-old-answer');
        assert.include(fixture.operations, 'setRemoteDescription:answer:reconnect-answer');
        assert.lengthOf(
          fixture.operations.filter((operation) =>
            operation.startsWith('setRemoteDescription:answer:'),
          ),
          2,
        );
        assert.deepStrictEqual(
          fixture.signals.flatMap((signal) =>
            signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer'
              ? [signal.negotiationEpoch]
              : [],
          ),
          [0, 1],
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('applies only ICE from the active reconnect epoch', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[0]!,
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new IceCandidateSignal({
              negotiationEpoch: 0,
              candidate: 'stale-ice',
              sdpMid: '0',
              sdpMLineIndex: 0,
              usernameFragment: null,
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new IceCandidateSignal({
              negotiationEpoch: 1,
              candidate: 'current-ice',
              sdpMid: '0',
              sdpMLineIndex: 0,
              usernameFragment: null,
            }),
          }),
        });

        assert.notInclude(fixture.operations, 'addIceCandidate:stale-ice');
        assert.include(fixture.operations, 'addIceCandidate:current-ice');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('reconnects on negotiation deadlines before reporting a stall', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const roomEventQueue = yield* Queue.unbounded<{ readonly event: RoomEvent }>();
        const offerSent = yield* Queue.unbounded<void>();
        let offerCount = 0;
        const fixture = yield* makeFixture(
          (() => Stream.fromQueue(roomEventQueue)) as AppClient['Service']['OpenRoomSession'],
          ({ signal }) =>
            signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer'
              ? Effect.gen(function* () {
                  offerCount += 1;
                  yield* Queue.offer(offerSent, undefined);
                })
              : Effect.void,
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'SessionStarted',
        });
        assert.strictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');

        yield* Queue.offer(roomEventQueue, {
          event: openedEvent(bob),
        });
        yield* Queue.take(offerSent);
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), roomOpened);

        yield* TestClock.adjust('20 seconds');
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'PeerInterrupted',
          peerId: bob,
        });
        yield* Queue.take(offerSent);

        yield* TestClock.adjust('20 seconds');
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'PeerInterrupted',
          peerId: bob,
        });
        yield* Queue.take(offerSent);

        yield* TestClock.adjust('20 seconds');
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'NegotiationStalled',
          peerId: bob,
        });
        assert.strictEqual(offerCount, 3);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('makes the second peer the offerer and opens its local data channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: 'remote-answer',
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
        });

        assert.deepStrictEqual(fixture.operations, [
          'acquirePeerConnection',
          'observePeerConnection',
          'addLocalTracks',
          'createDataChannel:chat',
          'observeDataChannel:chat',
          'createOffer',
          'setLocalDescription:offer:offer-sdp',
          'sendSignal:offer:offer-sdp',
          'setRemoteDescription:answer:remote-answer',
        ]);
        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'Connected', peerId: bob },
          { _tag: 'ChatReady' },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('makes the incumbent the answerer and accepts the remote data channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const remoteDataChannel: DataChannelHandle = {
          value: { label: 'chat' } satisfies TestDataChannel,
        };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'offer',
              sdp: 'remote-offer',
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: remoteDataChannel,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({ _tag: 'DataChannelOpened', dataChannel: remoteDataChannel });

        assert.deepStrictEqual(fixture.operations, [
          'acquirePeerConnection',
          'observePeerConnection',
          'addLocalTracks',
          'setRemoteDescription:offer:remote-offer',
          'createAnswer',
          'setLocalDescription:answer:answer-sdp',
          'sendSignal:answer:answer-sdp',
          'observeDataChannel:chat',
        ]);
        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'WaitingForPeer' },
          { _tag: 'Connected', peerId: bob },
          { _tag: 'ChatReady' },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('answers only newer offer epochs', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });

        for (const [negotiationEpoch, sdp] of [
          [4, 'first-offer'],
          [4, 'duplicate-offer'],
          [3, 'older-offer'],
          [5, 'newer-offer'],
        ] as const) {
          yield* fixture.actor({
            _tag: 'RoomEvent',
            event: new SignalReceivedEvent({
              peerId: bob,
              signal: new SessionDescriptionSignal({ negotiationEpoch, type: 'offer', sdp }),
            }),
          });
        }

        assert.include(fixture.operations, 'setRemoteDescription:offer:first-offer');
        assert.notInclude(fixture.operations, 'setRemoteDescription:offer:duplicate-offer');
        assert.notInclude(fixture.operations, 'setRemoteDescription:offer:older-offer');
        assert.include(fixture.operations, 'setRemoteDescription:offer:newer-offer');
        assert.deepStrictEqual(
          fixture.signals.flatMap((signal) =>
            signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'answer'
              ? [signal.negotiationEpoch]
              : [],
          ),
          [4, 5],
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('accepts a lower offer epoch after the active peer departs', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 7,
              type: 'offer',
              sdp: 'old-peer-offer',
            }),
          }),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerLeftEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new PeerJoinedEvent({ peerId: charlie }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: charlie,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'offer',
              sdp: 'replacement-offer',
            }),
          }),
        });

        assert.include(fixture.operations, 'setRemoteDescription:offer:old-peer-offer');
        assert.include(fixture.operations, 'setRemoteDescription:offer:replacement-offer');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('routes ICE and chat through the active peer and owned channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const localIce = {
          candidate: 'local-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        };
        const remoteIce = new IceCandidateSignal({
          negotiationEpoch: 0,
          candidate: 'remote-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        });

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: 'remote-answer',
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
        });
        yield* fixture.actor({
          _tag: 'LocalIceCandidate',
          peerConnection: fixture.peerConnection,
          candidate: localIce,
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({ peerId: bob, signal: remoteIce }),
        });
        yield* fixture.actor({ _tag: 'SendMessage', message: 'hello peer' });
        yield* fixture.actor({
          _tag: 'DataChannelMessageReceived',
          dataChannel: fixture.localDataChannel,
          data: 'hello self',
        });

        assert.includeMembers(fixture.operations, [
          'sendSignal:ice:local-ice',
          'addIceCandidate:remote-ice',
          'sendDataChannelMessage:hello peer',
        ]);
        assert.strictEqual(
          fixture.signals.find(
            (signal) =>
              signal._tag === '@tether/IceCandidateSignal' && signal.candidate === 'local-ice',
          )?.negotiationEpoch,
          0,
        );
        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'Connected', peerId: bob },
          { _tag: 'ChatReady' },
          {
            _tag: 'ChatMessageAdded',
            message: { id: 'aaaaaaaaaaaa:self:0', sender: 'self', text: 'hello peer' },
          },
          {
            _tag: 'ChatMessageAdded',
            message: { id: 'aaaaaaaaaaaa:peer:1', sender: 'peer', text: 'hello self' },
          },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('replaces a departed peer generation and rejects its stale events', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const staleIce = {
          candidate: 'stale-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        };
        const currentIce = {
          candidate: 'current-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        };
        const remoteDataChannel: DataChannelHandle = {
          value: { label: 'chat' } satisfies TestDataChannel,
        };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new PeerLeftEvent({ peerId: bob }),
        });

        assert.deepStrictEqual(fixture.operations, [
          'acquirePeerConnection',
          'observePeerConnection',
          'addLocalTracks',
          'createDataChannel:chat',
          'observeDataChannel:chat',
          'createOffer',
          'setLocalDescription:offer:offer-sdp',
          'sendSignal:offer:offer-sdp',
          'unobserveDataChannel:chat',
          'unobservePeerConnection',
          'closePeerConnection',
          'acquirePeerConnection',
          'observePeerConnection',
          'addLocalTracks',
        ]);
        assert.deepStrictEqual(fixture.events, [roomOpened, { _tag: 'PeerDeparted', peerId: bob }]);

        const replacementPeerConnection = fixture.peerConnections[1]!;
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new PeerJoinedEvent({ peerId: charlie }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: charlie,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'offer',
              sdp: 'replacement-offer',
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'LocalIceCandidate',
          peerConnection: fixture.peerConnection,
          candidate: staleIce,
        });
        yield* fixture.actor({
          _tag: 'LocalIceCandidate',
          peerConnection: replacementPeerConnection,
          candidate: currentIce,
        });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: replacementPeerConnection,
          dataChannel: remoteDataChannel,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: replacementPeerConnection,
        });
        yield* fixture.actor({ _tag: 'DataChannelOpened', dataChannel: remoteDataChannel });

        assert.notInclude(fixture.operations, 'sendSignal:ice:stale-ice');
        assert.include(fixture.operations, 'sendSignal:ice:current-ice');
        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'PeerDeparted', peerId: bob },
          { _tag: 'Connected', peerId: charlie },
          { _tag: 'ChatReady' },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores inputs from the wrong peer or invalid state', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const ice = {
          candidate: 'too-early',
          sdpMid: null,
          sdpMLineIndex: null,
          usernameFragment: null,
        };

        yield* fixture.actor({
          _tag: 'LocalIceCandidate',
          peerConnection: fixture.peerConnection,
          candidate: ice,
        });
        yield* fixture.actor({ _tag: 'SendMessage', message: 'too early' });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: mallory,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: 'wrong-peer',
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new PeerLeftEvent({ peerId: mallory }),
        });

        assert.lengthOf(fixture.signals, 1);
        assert.deepStrictEqual(fixture.events, [roomOpened]);
        assert.notInclude(fixture.operations, 'sendDataChannelMessage:too early');
        assert.notInclude(fixture.operations, 'setRemoteDescription:answer:wrong-peer');
        assert.notInclude(fixture.operations, 'closePeerConnection');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores local ICE before the answerer adopts an offer epoch', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'LocalIceCandidate',
          peerConnection: fixture.peerConnection,
          candidate: {
            candidate: 'epochless-ice',
            sdpMid: '0',
            sdpMLineIndex: 0,
            usernameFragment: null,
          },
        });

        assert.deepStrictEqual(fixture.signals, []);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores platform events from an unowned peer connection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const stalePeerConnection: PeerConnectionHandle = { value: { id: 'stale' } };
        const staleDataChannel: DataChannelHandle = {
          value: { label: 'chat' } satisfies TestDataChannel,
        };
        const staleIce = {
          candidate: 'stale-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'LocalIceCandidate',
          peerConnection: stalePeerConnection,
          candidate: staleIce,
        });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: stalePeerConnection,
          dataChannel: staleDataChannel,
        });

        assert.deepStrictEqual(fixture.signals, []);
        assert.notInclude(fixture.operations, 'observeDataChannel:chat');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('reacquires a fresh generation when the waiting peer connection fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const stalePeerConnection: PeerConnectionHandle = { value: { id: 'stale' } };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: stalePeerConnection,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnection,
        });

        // A failure while waiting stays generation-scoped: no failure event is
        // emitted after the initial waiting state, and the connection is replaced.
        assert.deepStrictEqual(fixture.events, [roomOpened, { _tag: 'WaitingForPeer' }]);
        assert.deepStrictEqual(
          fixture.operations.filter((operation) => operation === 'acquirePeerConnection').length,
          2,
        );
        assert.include(fixture.operations, 'closePeerConnection');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('emits PeerInterrupted and PeerRestored around a transient disconnection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });

        yield* fixture.actor({
          _tag: 'PeerConnectionInterrupted',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionRestored',
          peerConnection: fixture.peerConnection,
        });

        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'Connected', peerId: bob },
          { _tag: 'PeerInterrupted', peerId: bob },
          { _tag: 'PeerRestored', peerId: bob },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a disconnection before the peer connection is established', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        // A pre-connect connectivity blip is covered by negotiation/transport
        // handling, not the reconnecting projection.
        yield* fixture.actor({
          _tag: 'PeerConnectionInterrupted',
          peerConnection: fixture.peerConnection,
        });

        assert.deepStrictEqual(fixture.events, [roomOpened]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('marks chat unavailable without reconnecting when the data channel closes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const staleDataChannel: DataChannelHandle = {
          value: { label: 'chat' } satisfies TestDataChannel,
        };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
        });
        yield* fixture.actor({
          _tag: 'DataChannelClosed',
          dataChannel: staleDataChannel,
        });
        yield* fixture.actor({
          _tag: 'DataChannelClosed',
          dataChannel: fixture.localDataChannel,
        });

        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'Connected', peerId: bob },
          { _tag: 'ChatReady' },
          { _tag: 'ChatUnavailable' },
        ]);
        assert.notInclude(fixture.operations, 'closePeerConnection');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('emits RemoteStreamReady for the owned connection and ignores stale tracks', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const remoteStream: MediaStreamHandle = { value: { id: 'remote-media' } };
        const staleStream: MediaStreamHandle = { value: { id: 'stale-media' } };
        const stalePeerConnection: PeerConnectionHandle = { value: { id: 'stale' } };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RemoteTrackReceived',
          peerConnection: stalePeerConnection,
          stream: staleStream,
        });
        yield* fixture.actor({
          _tag: 'RemoteTrackReceived',
          peerConnection: fixture.peerConnection,
          stream: remoteStream,
        });

        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'RemoteStreamReady', stream: remoteStream },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a duplicate room session open', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });

        assert.lengthOf(
          fixture.operations.filter((operation) => operation === 'acquirePeerConnection'),
          1,
        );
        // A duplicate open re-surfaces the roomId before the ignore guard, so
        // RoomOpened is emitted again while the connection is not re-acquired.
        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'WaitingForPeer' },
          roomOpened,
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores PeerJoined before a room session opens', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });

        assert.deepStrictEqual(fixture.events, []);
        assert.notInclude(fixture.operations, 'acquirePeerConnection');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores an offer received while acting as the offerer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'offer',
              sdp: 'remote-offer',
            }),
          }),
        });

        assert.notInclude(fixture.operations, 'setRemoteDescription:offer:remote-offer');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores an answer received while acting as the answerer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(null),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: 'remote-answer',
            }),
          }),
        });

        assert.notInclude(fixture.operations, 'setRemoteDescription:answer:remote-answer');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('acquires a fresh generation when a peer departs after transport loss', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[0]!,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[1]!,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[2]!,
        });
        assert.deepStrictEqual(fixture.events.at(-1), { _tag: 'TransportLost', peerId: bob });

        const acquiredBefore = fixture.operations.filter(
          (operation) => operation === 'acquirePeerConnection',
        ).length;
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerLeftEvent({ peerId: bob }) });

        assert.deepStrictEqual(fixture.events.at(-1), { _tag: 'PeerDeparted', peerId: bob });
        assert.strictEqual(
          fixture.operations.filter((operation) => operation === 'acquirePeerConnection').length,
          acquiredBefore + 1,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores connected events from a stale or inactive generation', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const stalePeerConnection: PeerConnectionHandle = { value: { id: 'stale' } };

        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: stalePeerConnection,
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: stalePeerConnection,
        });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'Connected'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a duplicate connected event once established', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });

        assert.deepStrictEqual(
          fixture.events.filter((event) => event._tag === 'Connected'),
          [{ _tag: 'Connected', peerId: bob }],
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a restore while the connection is not interrupted', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionRestored',
          peerConnection: fixture.peerConnection,
        });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'PeerRestored'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('re-signals chat readiness and the safety code when a connection is restored', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const offerSdp = fingerprintSdp('AA:BB:CC:DD');
        const answerSdp = fingerprintSdp('11:22:33:44');
        const fixture = yield* makeFixture(undefined, undefined, {
          createOffer: () => Effect.succeed({ type: 'offer', sdp: offerSdp }),
        });

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({
              negotiationEpoch: 0,
              type: 'answer',
              sdp: answerSdp,
            }),
          }),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionInterrupted',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionRestored',
          peerConnection: fixture.peerConnection,
        });

        assert.deepStrictEqual(
          fixture.events.map((event) => event._tag),
          [
            'RoomOpened',
            'Connected',
            'SasReady',
            'ChatReady',
            'PeerInterrupted',
            'PeerRestored',
            'ChatReady',
            'SasReady',
          ],
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a duplicate data-channel opened event', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
        });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'ChatReady'),
          1,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a data-channel opened event for an unknown channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const unknownDataChannel: DataChannelHandle = {
          value: { label: 'chat' } satisfies TestDataChannel,
        };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({ _tag: 'DataChannelOpened', dataChannel: unknownDataChannel });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'ChatReady'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a chat message before the data channel opens', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'DataChannelMessageReceived',
          dataChannel: fixture.localDataChannel,
          data: 'too early',
        });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'ChatMessageAdded'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a non-text chat payload', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: openedEvent(bob),
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
        });
        yield* fixture.actor({
          _tag: 'DataChannelMessageReceived',
          dataChannel: fixture.localDataChannel,
          data: new Uint8Array([1, 2, 3]),
        });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'ChatMessageAdded'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('surfaces a join request without touching the connection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const displayName = DisplayName.make('Bob');

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new JoinRequestedEvent({ peerId: bob, displayName }),
        });

        // The knock only projects to the UI; no peer connection is acquired and
        // no offer/answer negotiation is started.
        assert.deepStrictEqual(fixture.events, [
          { _tag: 'JoinRequestReceived', peerId: bob, displayName },
        ]);
        assert.deepStrictEqual(fixture.operations, []);
        assert.deepStrictEqual(fixture.signals, []);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('surfaces a pending knock to the joiner', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new JoinPendingEvent(),
        });

        assert.deepStrictEqual(fixture.events, [{ _tag: 'JoinPending' }]);
        assert.deepStrictEqual(fixture.operations, []);
      }),
    ).pipe(Effect.orDie),
  );
});

describe('reducePeerSessionView', () => {
  it('resets the projection when a new session starts', () => {
    const view = reducePeerSessionView(
      {
        status: 'connected',
        messages: [{ id: 'message-1', sender: 'peer', text: 'from the previous session' }],
        chatReady: true,
        sas: '11111 22222 33333 44444 55555',
        pendingJoinRequests: [],
        roomId: null,
        roomTemplateId: null,
      },
      { _tag: 'SessionStarted' },
    );

    assert.deepStrictEqual(view, initialPeerSessionView);
  });

  it('projects actor events into UI state', () => {
    const waiting = reducePeerSessionView(initialPeerSessionView, {
      _tag: 'WaitingForPeer',
    });
    const connected = reducePeerSessionView(waiting, {
      _tag: 'Connected',
      peerId: bob,
    });
    const withChat = reducePeerSessionView(connected, { _tag: 'ChatReady' });
    const withSas = reducePeerSessionView(withChat, {
      _tag: 'SasReady',
      code: '11111 22222 33333 44444 55555',
    });
    const withMessage = reducePeerSessionView(withSas, {
      _tag: 'ChatMessageAdded',
      message: { id: 'message-1', sender: 'peer', text: 'hello' },
    });

    assert.deepStrictEqual(withMessage, {
      status: 'connected',
      messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
      chatReady: true,
      sas: '11111 22222 33333 44444 55555',
      pendingJoinRequests: [],
      roomId: null,
      roomTemplateId: null,
    });
  });

  it('projects signaling disconnection while preserving messages', () => {
    const view = reducePeerSessionView(
      {
        status: 'connected',
        messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
        chatReady: true,
        sas: '11111 22222 33333 44444 55555',
        pendingJoinRequests: [],
        roomId: null,
        roomTemplateId: null,
      },
      { _tag: 'SignalingDisconnected' },
    );

    assert.deepStrictEqual(view, {
      status: 'disconnected',
      messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
      chatReady: true,
      sas: '11111 22222 33333 44444 55555',
      pendingJoinRequests: [],
      roomId: null,
      roomTemplateId: null,
    });
  });

  it('marks only chat unavailable when its data channel closes', () => {
    const view = reducePeerSessionView(
      {
        status: 'connected',
        messages: [],
        chatReady: true,
        sas: '11111 22222 33333 44444 55555',
        pendingJoinRequests: [],
        roomId: null,
        roomTemplateId: null,
      },
      { _tag: 'ChatUnavailable' },
    );

    assert.deepStrictEqual(view, {
      status: 'connected',
      messages: [],
      chatReady: false,
      sas: '11111 22222 33333 44444 55555',
      pendingJoinRequests: [],
      roomId: null,
      roomTemplateId: null,
    });
  });

  it('projects an unexpected session failure while preserving messages', () => {
    const view = reducePeerSessionView(
      {
        status: 'connected',
        messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
        chatReady: true,
        sas: null,
        pendingJoinRequests: [],
        roomId: null,
        roomTemplateId: null,
      },
      { _tag: 'SessionFailed' },
    );

    assert.deepStrictEqual(view, {
      status: 'failed',
      messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
      chatReady: true,
      sas: null,
      pendingJoinRequests: [],
      roomId: null,
      roomTemplateId: null,
    });
  });

  it('projects a full-room rejection while preserving messages', () => {
    const view = reducePeerSessionView(
      {
        status: 'connecting',
        messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
        chatReady: false,
        sas: null,
        pendingJoinRequests: [],
        roomId: null,
        roomTemplateId: null,
      },
      { _tag: 'RoomJoinRejected', reason: 'room-full' },
    );

    assert.deepStrictEqual(view, {
      status: 'room-full',
      messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
      chatReady: false,
      sas: null,
      pendingJoinRequests: [],
      roomId: null,
      roomTemplateId: null,
    });
  });

  it('projects a duplicate-peer rejection while preserving messages', () => {
    const view = reducePeerSessionView(
      {
        status: 'connecting',
        messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
        chatReady: false,
        sas: null,
        pendingJoinRequests: [],
        roomId: null,
        roomTemplateId: null,
      },
      { _tag: 'RoomJoinRejected', reason: 'peer-already-joined' },
    );

    assert.deepStrictEqual(view, {
      status: 'peer-already-joined',
      messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
      chatReady: false,
      sas: null,
      pendingJoinRequests: [],
      roomId: null,
      roomTemplateId: null,
    });
  });

  it('returns to waiting when the active peer departs', () => {
    const view = reducePeerSessionView(
      {
        status: 'connected',
        messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
        chatReady: true,
        sas: '11111 22222 33333 44444 55555',
        pendingJoinRequests: [],
        roomId: null,
        roomTemplateId: null,
      },
      { _tag: 'PeerDeparted', peerId: bob },
    );

    assert.deepStrictEqual(view, {
      status: 'waiting-for-peer',
      messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
      chatReady: false,
      sas: null,
      pendingJoinRequests: [],
      roomId: null,
      roomTemplateId: null,
    });
  });
});

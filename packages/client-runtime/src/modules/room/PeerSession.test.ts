import { assert, describe, it } from '@effect/vitest';
import {
  IceCandidateSignal,
  PeerAlreadyJoined,
  PeerId,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomId,
  RoomFull,
  RoomSessionOpenedEvent,
  SessionDescriptionSignal,
  SignalReceivedEvent,
  type RoomEvent,
  type IceServer,
  type Signal,
} from '@tether/contracts/modules/room';
import { Deferred, Effect, Exit, Layer, Queue, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { RpcClientError } from 'effect/unstable/rpc';

import { AppClient } from '../../AppClient';
import { makePeerSessionActor, startPeerSession } from './PeerSession';
import {
  initialPeerSessionView,
  PlatformError,
  reducePeerSessionView,
  type DataChannelHandle,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PeerSessionEvent,
  type PlatformEvent,
  type PlatformEventDispatch,
  type RoomSession,
} from './PeerSessionModel';
import { PeerSessionEventSink, PeerSessionPlatform } from './PeerSessionServices';

interface TestPeerConnection {
  readonly id: string;
}

interface TestDataChannel {
  readonly label: string;
}

const session: RoomSession = {
  roomId: RoomId.make('room-1'),
  selfId: PeerId.make('alice'),
};
const bob = PeerId.make('bob');
const charlie = PeerId.make('charlie');
const mallory = PeerId.make('mallory');
const testSessionToken = 'test-session-token';

const makeFixture = Effect.fn('makeFixture')(function* (
  openRoomSession: AppClient['Service']['OpenRoomSession'] = (() =>
    Stream.empty) as AppClient['Service']['OpenRoomSession'],
  sendSignal?: AppClient['Service']['SendSignal'],
  overrides?: Partial<PeerSessionPlatform['Service']>,
  getIceServers?: () => Effect.Effect<
    { readonly iceServers: ReadonlyArray<IceServer> },
    RpcClientError.RpcClientError
  >,
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

  const dependencies = Layer.mergeAll(
    Layer.succeed(PeerSessionPlatform, platform),
    Layer.succeed(
      AppClient,
      AppClient.of({
        GetIceServers: (getIceServers ??
          (() => Effect.succeed({ iceServers: [] }))) as AppClient['Service']['GetIceServers'],
        LeaveRoom: () =>
          Effect.sync(() => {
            operations.push('leaveRoom');
          }),
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
  );

  const actor = yield* makePeerSessionActor(session, localMediaStream, [], () => {}).pipe(
    Effect.provide(dependencies),
  );

  return {
    acquiredIceServers,
    actor: actor.handleInput,
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
    sentSessionTokens,
    signals,
  };
});

describe('startPeerSession', () => {
  it.effect('passes fetched ICE servers to peer connection acquisition', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const offerSent = yield* Deferred.make<void>();
        const iceServers = [
          {
            urls: ['turn:turn.example.com:3478'],
            username: 'turn-user',
            credential: 'turn-password',
          },
        ];
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          ({ signal }) =>
            signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer'
              ? Deferred.succeed(offerSent, undefined)
              : Effect.void,
          undefined,
          () => Effect.succeed({ iceServers }),
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        yield* Deferred.await(offerSent);

        assert.deepStrictEqual(fixture.acquiredIceServers, [iceServers]);
      }),
    ),
  );

  it.effect('falls back to the default STUN server when ICE config fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const offerSent = yield* Deferred.make<void>();
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          ({ signal }) =>
            signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer'
              ? Deferred.succeed(offerSent, undefined)
              : Effect.void,
          undefined,
          () =>
            Effect.fail(
              new RpcClientError.RpcClientError({
                reason: new RpcClientError.RpcClientDefect({
                  message: 'ICE config unavailable',
                  cause: 'boom',
                }),
              }),
            ),
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
              event: new RoomSessionOpenedEvent({
                peerId: bob,
                sessionToken: testSessionToken,
              }),
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
        const fixture = yield* makeFixture();
        const peerSession = yield* startPeerSession(session).pipe(
          Effect.provide(fixture.dependencies),
        );

        yield* Effect.promise(() => Promise.all([peerSession.leave(), peerSession.leave()]));

        assert.lengthOf(
          fixture.operations.filter((operation) => operation === 'leaveRoom'),
          1,
        );
      }),
    ),
  );

  it.effect('emits WaitingForPeer when the room opens without another peer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture((() =>
          Stream.make({
            event: new RoomSessionOpenedEvent({ peerId: null, sessionToken: testSessionToken }),
          })) as AppClient['Service']['OpenRoomSession']);

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));

        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'SessionStarted');
        assert.deepStrictEqual((yield* Queue.take(fixture.eventQueue))._tag, 'LocalStreamReady');
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

  it.effect('emits SignalingDisconnected when SendSignal finds no room membership', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(
          (() =>
            Stream.make({
              event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
            }).pipe(Stream.concat(Stream.never))) as AppClient['Service']['OpenRoomSession'],
          (() =>
            Effect.fail(
              new PeerNotInRoom({ roomId: session.roomId, peerId: session.selfId }),
            )) as AppClient['Service']['SendSignal'],
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        const started = yield* Queue.take(fixture.eventQueue);
        const localStream = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.strictEqual(localStream._tag, 'LocalStreamReady');
        assert.deepStrictEqual(event, { _tag: 'SignalingDisconnected' });
      }),
    ),
  );

  it.effect('processes PeerLeft while reconnecting after the data channel closes', () =>
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
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* Deferred.await(offerSent);

        fixture.dispatchPlatformEvent({
          _tag: 'DataChannelClosed',
          dataChannel: fixture.localDataChannel,
        });
        yield* Effect.yieldNow;
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'PeerInterrupted',
          peerId: bob,
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
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        // The offer is sent, so the actor is now in DataChannelConnecting. The
        // peer never answers and no DataChannelOpened arrives; because the remote
        // description is never set, ICE never starts and the browser never fires
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

  it.effect('does not stall once the data channel opens before the deadline', () =>
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
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* Deferred.await(offerSent);

        fixture.dispatchPlatformEvent({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
        });
        assert.deepStrictEqual(yield* Queue.take(fixture.eventQueue), {
          _tag: 'Connected',
          peerId: bob,
        });

        // The deadline is never cancelled; it still fires but the handler drops
        // it because the channel is already open.
        yield* TestClock.adjust('20 seconds');
        yield* Effect.yieldNow;

        const stalled = fixture.events.filter((event) => event._tag === 'NegotiationStalled');
        assert.deepStrictEqual(stalled, []);
      }),
    ),
  );
});

describe('peer-session actor', () => {
  it.effect('drops a failed ICE candidate and continues processing signals', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture(undefined, undefined, {
          addIceCandidate: () =>
            Effect.fail(new PlatformError({ operation: 'add-ice-candidate', cause: 'boom' })),
        });
        const remoteIce = new IceCandidateSignal({
          candidate: 'invalid-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        });

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({ peerId: bob, signal: remoteIce }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({ type: 'answer', sdp: 'remote-answer' }),
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
          signal: new SessionDescriptionSignal({ type: 'answer', sdp: 'remote-answer' }),
        });

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
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
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
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
        const remoteDataChannel: DataChannelHandle = {
          value: { label: 'chat' } satisfies TestDataChannel,
        };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: null, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: remoteDataChannel,
        });
        yield* fixture.actor({ _tag: 'DataChannelOpened', dataChannel: remoteDataChannel });
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
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
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

  it.effect('refills the reconnect budget after the replacement channel opens', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.localDataChannel,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[0]!,
        });
        yield* fixture.actor({
          _tag: 'DataChannelOpened',
          dataChannel: fixture.dataChannels[1]!,
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnections[1]!,
        });

        assert.deepStrictEqual(fixture.events, [
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

  it.effect('accepts a fresh answer after reconnecting', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({ type: 'answer', sdp: 'initial-answer' }),
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
            signal: new SessionDescriptionSignal({ type: 'answer', sdp: 'reconnect-answer' }),
          }),
        });

        assert.include(fixture.operations, 'setRemoteDescription:answer:reconnect-answer');
        assert.lengthOf(
          fixture.operations.filter((operation) =>
            operation.startsWith('setRemoteDescription:answer:'),
          ),
          2,
        );
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
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
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
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({ type: 'answer', sdp: 'remote-answer' }),
          }),
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
        assert.deepStrictEqual(fixture.events, [{ _tag: 'Connected', peerId: bob }]);
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
          event: new RoomSessionOpenedEvent({ peerId: null, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({ type: 'offer', sdp: 'remote-offer' }),
          }),
        });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: remoteDataChannel,
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
          { _tag: 'WaitingForPeer' },
          { _tag: 'Connected', peerId: bob },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('routes ICE and chat through the active peer and owned channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const localIce = new IceCandidateSignal({
          candidate: 'local-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        });
        const remoteIce = new IceCandidateSignal({
          candidate: 'remote-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        });

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new SessionDescriptionSignal({ type: 'answer', sdp: 'remote-answer' }),
          }),
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
        assert.deepStrictEqual(fixture.events, [
          { _tag: 'Connected', peerId: bob },
          {
            _tag: 'ChatMessageAdded',
            message: { id: 'alice:self:0', sender: 'self', text: 'hello peer' },
          },
          {
            _tag: 'ChatMessageAdded',
            message: { id: 'alice:peer:1', sender: 'peer', text: 'hello self' },
          },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('replaces a departed peer generation and rejects its stale events', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const staleIce = new IceCandidateSignal({
          candidate: 'stale-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        });
        const currentIce = new IceCandidateSignal({
          candidate: 'current-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        });
        const remoteDataChannel: DataChannelHandle = {
          value: { label: 'chat' } satisfies TestDataChannel,
        };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
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
        assert.deepStrictEqual(fixture.events, [{ _tag: 'PeerDeparted', peerId: bob }]);

        const replacementPeerConnection = fixture.peerConnections[1]!;
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new PeerJoinedEvent({ peerId: charlie }),
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
        yield* fixture.actor({ _tag: 'DataChannelOpened', dataChannel: remoteDataChannel });

        assert.notInclude(fixture.operations, 'sendSignal:ice:stale-ice');
        assert.include(fixture.operations, 'sendSignal:ice:current-ice');
        assert.deepStrictEqual(fixture.events, [
          { _tag: 'PeerDeparted', peerId: bob },
          { _tag: 'Connected', peerId: charlie },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores inputs from the wrong peer or invalid state', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const ice = new IceCandidateSignal({
          candidate: 'too-early',
          sdpMid: null,
          sdpMLineIndex: null,
          usernameFragment: null,
        });

        yield* fixture.actor({
          _tag: 'LocalIceCandidate',
          peerConnection: fixture.peerConnection,
          candidate: ice,
        });
        yield* fixture.actor({ _tag: 'SendMessage', message: 'too early' });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: mallory,
            signal: new SessionDescriptionSignal({ type: 'answer', sdp: 'wrong-peer' }),
          }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new PeerLeftEvent({ peerId: mallory }),
        });

        assert.lengthOf(fixture.signals, 1);
        assert.deepStrictEqual(fixture.events, []);
        assert.notInclude(fixture.operations, 'sendDataChannelMessage:too early');
        assert.notInclude(fixture.operations, 'setRemoteDescription:answer:wrong-peer');
        assert.notInclude(fixture.operations, 'closePeerConnection');
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
        const staleIce = new IceCandidateSignal({
          candidate: 'stale-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        });

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: null, sessionToken: testSessionToken }),
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
          event: new RoomSessionOpenedEvent({ peerId: null, sessionToken: testSessionToken }),
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
        assert.deepStrictEqual(fixture.events, [{ _tag: 'WaitingForPeer' }]);
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
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
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

        assert.deepStrictEqual(fixture.events, [
          { _tag: 'Connected', peerId: bob },
          { _tag: 'PeerInterrupted', peerId: bob },
          { _tag: 'PeerRestored', peerId: bob },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a disconnection before the data channel is open', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        // Still in DataChannelConnecting — a connectivity blip here is covered
        // by negotiation/transport handling, not the reconnecting projection.
        yield* fixture.actor({
          _tag: 'PeerConnectionInterrupted',
          peerConnection: fixture.peerConnection,
        });

        assert.deepStrictEqual(fixture.events, []);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('reconnects when the current data channel closes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const staleDataChannel: DataChannelHandle = {
          value: { label: 'chat' } satisfies TestDataChannel,
        };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
        });
        yield* fixture.actor({
          _tag: 'DataChannelClosed',
          dataChannel: staleDataChannel,
        });
        yield* fixture.actor({
          _tag: 'DataChannelClosed',
          dataChannel: fixture.localDataChannel,
        });

        assert.deepStrictEqual(fixture.events, [{ _tag: 'PeerInterrupted', peerId: bob }]);
        assert.include(fixture.operations, 'closePeerConnection');
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
          event: new RoomSessionOpenedEvent({ peerId: bob, sessionToken: testSessionToken }),
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
          { _tag: 'RemoteStreamReady', stream: remoteStream },
        ]);
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
    const withMessage = reducePeerSessionView(connected, {
      _tag: 'ChatMessageAdded',
      message: { id: 'message-1', sender: 'peer', text: 'hello' },
    });

    assert.deepStrictEqual(withMessage, {
      status: 'connected',
      messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
    });
  });

  it('projects signaling disconnection while preserving messages', () => {
    const view = reducePeerSessionView(
      {
        status: 'connected',
        messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
      },
      { _tag: 'SignalingDisconnected' },
    );

    assert.deepStrictEqual(view, {
      status: 'disconnected',
      messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
    });
  });

  it('projects an unexpected session failure while preserving messages', () => {
    const view = reducePeerSessionView(
      {
        status: 'connected',
        messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
      },
      { _tag: 'SessionFailed' },
    );

    assert.deepStrictEqual(view, {
      status: 'failed',
      messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
    });
  });

  it('projects a full-room rejection while preserving messages', () => {
    const view = reducePeerSessionView(
      {
        status: 'connecting',
        messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
      },
      { _tag: 'RoomJoinRejected', reason: 'room-full' },
    );

    assert.deepStrictEqual(view, {
      status: 'room-full',
      messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
    });
  });

  it('projects a duplicate-peer rejection while preserving messages', () => {
    const view = reducePeerSessionView(
      {
        status: 'connecting',
        messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
      },
      { _tag: 'RoomJoinRejected', reason: 'peer-already-joined' },
    );

    assert.deepStrictEqual(view, {
      status: 'peer-already-joined',
      messages: [{ id: 'message-1', sender: 'self', text: 'hello' }],
    });
  });

  it('returns to waiting when the active peer departs', () => {
    const view = reducePeerSessionView(
      {
        status: 'connected',
        messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
      },
      { _tag: 'PeerDeparted', peerId: bob },
    );

    assert.deepStrictEqual(view, {
      status: 'waiting-for-peer',
      messages: [{ id: 'message-1', sender: 'peer', text: 'hello' }],
    });
  });
});

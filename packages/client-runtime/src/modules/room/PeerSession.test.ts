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
  type Signal,
} from '@tether/contracts/modules/room';
import { Effect, Layer, Queue, Stream } from 'effect';

import { AppClient } from '../../AppClient';
import { makePeerSessionActor, startPeerSession } from './PeerSession';
import {
  initialPeerSessionView,
  reducePeerSessionView,
  type DataChannelHandle,
  type PeerConnectionHandle,
  type PeerSessionEvent,
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

const makeFixture = Effect.fn('makeFixture')(function* (
  openRoomSession: AppClient['Service']['OpenRoomSession'] = (() =>
    Stream.empty) as AppClient['Service']['OpenRoomSession'],
  sendSignal?: AppClient['Service']['SendSignal'],
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
  const localDataChannel: DataChannelHandle = {
    value: { label: 'chat' } satisfies TestDataChannel,
  };
  const operations: Array<string> = [];
  const signals: Array<Signal> = [];
  const events: Array<PeerSessionEvent> = [];
  const eventQueue = yield* Queue.unbounded<PeerSessionEvent>();

  const platform = PeerSessionPlatform.of({
    acquirePeerConnection: Effect.acquireRelease(
      Effect.sync(() => {
        operations.push('acquirePeerConnection');
        return peerConnections[nextPeerConnection++] ?? makePeerConnection();
      }),
      () => Effect.sync(() => operations.push('closePeerConnection')),
    ),
    observePeerConnection: () =>
      Effect.acquireRelease(
        Effect.sync(() => operations.push('observePeerConnection')),
        () => Effect.sync(() => operations.push('unobservePeerConnection')),
      ),
    createDataChannel: (_, label) =>
      Effect.sync(() => {
        operations.push(`createDataChannel:${label}`);
        return localDataChannel;
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
  });

  const dependencies = Layer.mergeAll(
    Layer.succeed(PeerSessionPlatform, platform),
    Layer.succeed(
      AppClient,
      AppClient.of({
        OpenRoomSession: openRoomSession,
        SendSignal:
          sendSignal ??
          (({ signal }) =>
            Effect.sync(() => {
              signals.push(signal);
              operations.push(
                signal._tag === '@tether/SessionDescriptionSignal'
                  ? `sendSignal:${signal.type}:${signal.sdp}`
                  : `sendSignal:ice:${signal.candidate}`,
              );
            })),
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

  const actor = yield* makePeerSessionActor(session, () => {}).pipe(Effect.provide(dependencies));

  return {
    actor,
    dependencies,
    eventQueue,
    events,
    localDataChannel,
    operations,
    peerConnection,
    peerConnections,
    signals,
  };
});

describe('startPeerSession', () => {
  it.effect('emits SignalingDisconnected when the room stream ends normally', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        const started = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.deepStrictEqual(event, { _tag: 'SignalingDisconnected' });
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
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.deepStrictEqual(event, {
          _tag: 'RoomJoinRejected',
          reason: 'room-full',
        });
      }),
    ),
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
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
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
            Stream.make({ event: new RoomSessionOpenedEvent({ peerId: bob }) }).pipe(
              Stream.concat(Stream.never),
            )) as AppClient['Service']['OpenRoomSession'],
          (() =>
            Effect.fail(
              new PeerNotInRoom({ roomId: session.roomId, peerId: session.selfId }),
            )) as AppClient['Service']['SendSignal'],
        );

        yield* startPeerSession(session).pipe(Effect.provide(fixture.dependencies));
        const started = yield* Queue.take(fixture.eventQueue);
        const event = yield* Queue.take(fixture.eventQueue);

        assert.deepStrictEqual(started, { _tag: 'SessionStarted' });
        assert.deepStrictEqual(event, { _tag: 'SignalingDisconnected' });
      }),
    ),
  );
});

describe('peer-session actor', () => {
  it.effect('makes the second peer the offerer and opens its local data channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob }),
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
          event: new RoomSessionOpenedEvent({ peerId: null }),
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
          'setRemoteDescription:offer:remote-offer',
          'createAnswer',
          'setLocalDescription:answer:answer-sdp',
          'sendSignal:answer:answer-sdp',
          'observeDataChannel:chat',
        ]);
        assert.deepStrictEqual(fixture.events, [{ _tag: 'Connected', peerId: bob }]);
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
          event: new RoomSessionOpenedEvent({ peerId: bob }),
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
          event: new RoomSessionOpenedEvent({ peerId: bob }),
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new PeerLeftEvent({ peerId: bob }),
        });

        assert.deepStrictEqual(fixture.operations, [
          'acquirePeerConnection',
          'observePeerConnection',
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
          event: new RoomSessionOpenedEvent({ peerId: bob }),
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
          event: new RoomSessionOpenedEvent({ peerId: null }),
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

  it.effect('fails when the current waiting peer connection fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const stalePeerConnection: PeerConnectionHandle = { value: { id: 'stale' } };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: null }),
        });
        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: stalePeerConnection,
        });
        const error = yield* fixture
          .actor({
            _tag: 'PeerConnectionFailed',
            peerConnection: fixture.peerConnection,
          })
          .pipe(Effect.flip);

        assert.isTrue(
          typeof error === 'object' &&
            error !== null &&
            '_tag' in error &&
            error._tag === 'PeerTransportFailure' &&
            'reason' in error &&
            error.reason === 'peer-connection-failed',
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('fails when the current data channel closes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const staleDataChannel: DataChannelHandle = {
          value: { label: 'chat' } satisfies TestDataChannel,
        };

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new RoomSessionOpenedEvent({ peerId: bob }),
        });
        yield* fixture.actor({
          _tag: 'DataChannelClosed',
          dataChannel: staleDataChannel,
        });
        const error = yield* fixture
          .actor({
            _tag: 'DataChannelClosed',
            dataChannel: fixture.localDataChannel,
          })
          .pipe(Effect.flip);

        assert.isTrue(
          typeof error === 'object' &&
            error !== null &&
            '_tag' in error &&
            error._tag === 'PeerTransportFailure' &&
            'reason' in error &&
            error.reason === 'data-channel-closed',
        );
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
    const connected = reducePeerSessionView(initialPeerSessionView, {
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

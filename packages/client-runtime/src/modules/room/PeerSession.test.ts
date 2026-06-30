import { assert, describe, it } from '@effect/vitest';
import {
  IceCandidateSignal,
  PeerId,
  PeerJoinedEvent,
  RoomId,
  RoomSessionOpenedEvent,
  SessionDescriptionSignal,
  SignalReceivedEvent,
  type Signal,
} from '@tether/contracts/modules/room';
import { Effect, Layer, Stream } from 'effect';

import { AppClient } from '../../AppClient';
import { makePeerSessionActor } from './PeerSession';
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
  readonly id: 'peer-connection';
}

interface TestDataChannel {
  readonly label: string;
}

const session: RoomSession = {
  roomId: RoomId.make('room-1'),
  selfId: PeerId.make('alice'),
};
const bob = PeerId.make('bob');
const mallory = PeerId.make('mallory');

const makeFixture = Effect.fn('makeFixture')(function* () {
  const peerConnection: PeerConnectionHandle = {
    value: { id: 'peer-connection' } satisfies TestPeerConnection,
  };
  const localDataChannel: DataChannelHandle = {
    value: { label: 'chat' } satisfies TestDataChannel,
  };
  const operations: Array<string> = [];
  const signals: Array<Signal> = [];
  const events: Array<PeerSessionEvent> = [];

  const platform = PeerSessionPlatform.of({
    acquirePeerConnection: Effect.acquireRelease(
      Effect.sync(() => {
        operations.push('acquirePeerConnection');
        return peerConnection;
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
        OpenRoomSession: (() => Stream.empty) as AppClient['Service']['OpenRoomSession'],
        SendSignal: ({ signal }) =>
          Effect.sync(() => {
            signals.push(signal);
            operations.push(
              signal._tag === '@tether/SessionDescriptionSignal'
                ? `sendSignal:${signal.type}:${signal.sdp}`
                : `sendSignal:ice:${signal.candidate}`,
            );
          }),
      }),
    ),
    Layer.succeed(
      PeerSessionEventSink,
      PeerSessionEventSink.of({
        emit: (event) => Effect.sync(() => events.push(event)),
      }),
    ),
  );

  const actor = yield* makePeerSessionActor(session, () => {}).pipe(Effect.provide(dependencies));

  return {
    actor,
    events,
    localDataChannel,
    operations,
    signals,
  };
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
        yield* fixture.actor({ _tag: 'RemoteDataChannel', dataChannel: remoteDataChannel });
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
        yield* fixture.actor({ _tag: 'LocalIceCandidate', candidate: localIce });
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

  it.effect('ignores commands from the wrong peer or invalid state', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const ice = new IceCandidateSignal({
          candidate: 'too-early',
          sdpMid: null,
          sdpMLineIndex: null,
          usernameFragment: null,
        });

        yield* fixture.actor({ _tag: 'LocalIceCandidate', candidate: ice });
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

        assert.lengthOf(fixture.signals, 1);
        assert.deepStrictEqual(fixture.events, []);
        assert.notInclude(fixture.operations, 'sendDataChannelMessage:too early');
        assert.notInclude(fixture.operations, 'setRemoteDescription:answer:wrong-peer');
      }),
    ).pipe(Effect.orDie),
  );
});

describe('reducePeerSessionView', () => {
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
});

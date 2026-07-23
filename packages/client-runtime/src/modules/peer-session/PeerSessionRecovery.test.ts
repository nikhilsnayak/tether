import { assert, describe, it } from '@effect/vitest';
import {
  IceCandidateSignal,
  PeerJoinedEvent,
  PeerLeftEvent,
  RoomTemplateId,
  SessionDescriptionSignal,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { Effect } from 'effect';

import { type DataChannelHandle, type MediaStreamHandle, type PeerConnectionHandle } from './Model';
import { PlatformError } from './Platform';
import { ROOM_EVENTS_CHANNEL_LABEL } from './RoomEvents';
import {
  bob,
  charlie,
  mallory,
  makePeerSessionTestHarness,
  roomOpened,
  type TestDataChannel,
} from './test/PeerSessionTestHarness';
import { WATCH_CONTROL_CHANNEL_LABEL } from './WatchTransport';

describe('peer-session actor — recovery and ownership', () => {
  const fingerprintSdp = (fingerprint: string) =>
    ['v=0', `a=fingerprint:sha-256 ${fingerprint}`, ''].join('\r\n');

  it.effect('routes ICE and chat through the active peer and owned channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
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

        yield* fixture.openRoom(bob);
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
        yield* fixture.openRoomEvents();
        yield* fixture.actor({
          _tag: 'LocalIceCandidate',
          peerConnection: fixture.peerConnection,
          candidate: localIce,
        });
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({ peerId: bob, signal: remoteIce }),
        });
        yield* fixture.sendChat('hello peer');
        yield* fixture.actor({
          _tag: 'DataChannelMessageReceived',
          dataChannel: fixture.localDataChannel,
          data: JSON.stringify({
            version: 1,
            type: 'chat-message',
            text: 'hello self',
          }),
        });

        assert.includeMembers(fixture.operations, [
          'sendSignal:ice:local-ice',
          'addIceCandidate:remote-ice',
          'sendDataChannelMessage:{"version":1,"type":"chat-message","text":"hello peer"}',
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
          { _tag: 'RoomEventsReady' },
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
        const fixture = yield* makePeerSessionTestHarness();
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
          value: { label: ROOM_EVENTS_CHANNEL_LABEL } satisfies TestDataChannel,
        };

        yield* fixture.openRoom(bob);
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new PeerLeftEvent({ peerId: bob }),
        });

        assert.deepStrictEqual(fixture.operations, [
          'acquirePeerConnection',
          'observePeerConnection',
          'addLocalTracks',
          'reserveProgramTransceivers',
          `createDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`,
          `observeDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`,
          `createDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`,
          `observeDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`,
          'createOffer',
          'setLocalDescription:offer:offer-sdp',
          'sendSignal:offer:offer-sdp',
          `unobserveDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`,
          `unobserveDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`,
          'unobservePeerConnection',
          'closePeerConnection',
          'acquirePeerConnection',
          'observePeerConnection',
          'addLocalTracks',
          'reserveProgramTransceivers',
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
          { _tag: 'RoomEventsReady' },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores inputs from the wrong peer or invalid state', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
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
        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(null);
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
        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: new IceCandidateSignal({
              negotiationEpoch: 0,
              candidate: 'remote-epochless-ice',
              sdpMid: '0',
              sdpMLineIndex: 0,
              usernameFragment: null,
            }),
          }),
        });

        assert.deepStrictEqual(fixture.signals, []);
        assert.notInclude(fixture.operations, 'addIceCandidate:remote-epochless-ice');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores platform events from an unowned peer connection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        const stalePeerConnection: PeerConnectionHandle = { value: { id: 'stale' } };
        const staleDataChannel: DataChannelHandle = {
          value: { label: ROOM_EVENTS_CHANNEL_LABEL } satisfies TestDataChannel,
        };
        const staleIce = {
          candidate: 'stale-ice',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        };

        yield* fixture.openRoom(null);
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
        assert.notInclude(fixture.operations, `observeDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('closes unexpected and duplicate remote data channels when supported', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const closed: DataChannelHandle[] = [];
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          closeDataChannel: (dataChannel) =>
            Effect.sync(() => {
              closed.push(dataChannel);
            }),
        });
        const wrongLabel: DataChannelHandle = { value: { label: 'chat' } };
        const accepted: DataChannelHandle = {
          value: { label: ROOM_EVENTS_CHANNEL_LABEL },
        };
        const duplicate: DataChannelHandle = {
          value: { label: ROOM_EVENTS_CHANNEL_LABEL },
        };
        const watchAccepted: DataChannelHandle = {
          value: { label: WATCH_CONTROL_CHANNEL_LABEL },
        };
        const watchDuplicate: DataChannelHandle = {
          value: { label: WATCH_CONTROL_CHANNEL_LABEL },
        };

        yield* fixture.openRoom(null);
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        for (const dataChannel of [
          wrongLabel,
          accepted,
          duplicate,
          watchAccepted,
          watchDuplicate,
        ]) {
          yield* fixture.actor({
            _tag: 'RemoteDataChannel',
            peerConnection: fixture.peerConnection,
            dataChannel,
          });
        }

        assert.deepStrictEqual(closed, [wrongLabel, duplicate, watchDuplicate]);
        assert.include(fixture.operations, `observeDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`);
        assert.include(fixture.operations, `observeDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('accepts a watch channel that arrives before the room-events channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const closed: DataChannelHandle[] = [];
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          closeDataChannel: (dataChannel) =>
            Effect.sync(() => {
              closed.push(dataChannel);
            }),
        });
        const watchChannel: DataChannelHandle = { value: { label: WATCH_CONTROL_CHANNEL_LABEL } };
        const roomChannel: DataChannelHandle = { value: { label: ROOM_EVENTS_CHANNEL_LABEL } };

        yield* fixture.openRoom(null);
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        // Watch first: it must not consume or advance the room-events channel state.
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: watchChannel,
        });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: roomChannel,
        });
        yield* fixture.openRoomEvents(roomChannel);

        assert.deepStrictEqual(closed, []);
        assert.include(fixture.operations, `observeDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`);
        assert.include(fixture.operations, `observeDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`);
        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'RoomEventsReady'),
          1,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('closes a remote watch channel on a template without watch-along', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const closed: DataChannelHandle[] = [];
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          closeDataChannel: (dataChannel) =>
            Effect.sync(() => {
              closed.push(dataChannel);
            }),
        });
        const watchChannel: DataChannelHandle = { value: { label: WATCH_CONTROL_CHANNEL_LABEL } };
        const roomChannel: DataChannelHandle = { value: { label: ROOM_EVENTS_CHANNEL_LABEL } };

        yield* fixture.openRoom(null, RoomTemplateId.make('plain-suite'));
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: watchChannel,
        });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: roomChannel,
        });

        assert.deepStrictEqual(closed, [watchChannel]);
        assert.notInclude(fixture.operations, 'reserveProgramTransceivers');
        assert.include(fixture.operations, `observeDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`);
        assert.notInclude(fixture.operations, `observeDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores messages delivered on the watch channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watchChannel: DataChannelHandle = { value: { label: WATCH_CONTROL_CHANNEL_LABEL } };

        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(null);
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: watchChannel,
        });
        const eventsBefore = fixture.events.length;
        yield* fixture.actor({
          _tag: 'DataChannelMessageReceived',
          dataChannel: watchChannel,
          data: JSON.stringify({ version: 1, type: 'chat-message', text: 'ignored' }),
        });

        assert.strictEqual(fixture.events.length, eventsBefore);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('contains a failure while closing an unexpected remote data channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          closeDataChannel: () =>
            Effect.fail(new PlatformError({ operation: 'close-data-channel', cause: 'closed' })),
        });
        const unexpected: DataChannelHandle = { value: { label: 'unexpected' } };

        yield* fixture.openRoom(null);
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: unexpected,
        });

        assert.notInclude(
          fixture.events.map((event) => event._tag),
          'SessionFailed',
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('reacquires a fresh generation when the waiting peer connection fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        const stalePeerConnection: PeerConnectionHandle = { value: { id: 'stale' } };

        yield* fixture.openRoom(null);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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

  it.effect('keeps interruption recovery alive when an unopened watch channel cannot close', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failedClose = yield* makePeerSessionTestHarness(undefined, undefined, {
          closeDataChannel: () =>
            Effect.fail(new PlatformError({ operation: 'close-data-channel', cause: 'failed' })),
        });
        yield* failedClose.openRoom(bob);
        yield* failedClose.connectionConnected();
        yield* failedClose.connectionInterrupted();
        assert.isTrue(failedClose.events.some((event) => event._tag === 'PeerInterrupted'));

        const unsupportedClose = yield* makePeerSessionTestHarness(undefined, undefined, {
          closeDataChannel: undefined,
        });
        yield* unsupportedClose.openRoom(bob);
        yield* unsupportedClose.connectionConnected();
        yield* unsupportedClose.connectionInterrupted();
        assert.isTrue(unsupportedClose.events.some((event) => event._tag === 'PeerInterrupted'));
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a disconnection before the peer connection is established', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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

  it.effect('marks room events unavailable without reconnecting when the channel closes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        const staleDataChannel: DataChannelHandle = {
          value: { label: ROOM_EVENTS_CHANNEL_LABEL } satisfies TestDataChannel,
        };

        yield* fixture.openRoom(bob);
        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: fixture.peerConnection,
        });
        yield* fixture.openRoomEvents();
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
          { _tag: 'RoomEventsReady' },
          { _tag: 'RoomEventsUnavailable' },
        ]);
        assert.notInclude(fixture.operations, 'closePeerConnection');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('emits RemoteStreamReady for the owned connection and ignores stale tracks', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        const remoteStream: MediaStreamHandle = { value: { id: 'remote-media' } };
        const staleStream: MediaStreamHandle = { value: { id: 'stale-media' } };
        const stalePeerConnection: PeerConnectionHandle = { value: { id: 'stale' } };

        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(null);
        yield* fixture.openRoom(bob);

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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerJoinedEvent({ peerId: bob }) });

        assert.deepStrictEqual(fixture.events, []);
        assert.notInclude(fixture.operations, 'acquirePeerConnection');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores an offer received while acting as the offerer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(null);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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
        assert.deepStrictEqual(fixture.events.at(-1), {
          _tag: 'TransportLost',
          peerId: bob,
          diagnostic: 'no-network-candidates',
        });

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
        const fixture = yield* makePeerSessionTestHarness();
        const stalePeerConnection: PeerConnectionHandle = { value: { id: 'stale' } };

        yield* fixture.actor({
          _tag: 'PeerConnectionConnected',
          peerConnection: stalePeerConnection,
        });
        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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

  it.effect('re-signals room-event readiness and the safety code after connection recovery', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const offerSdp = fingerprintSdp('AA:BB:CC:DD');
        const answerSdp = fingerprintSdp('11:22:33:44');
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          createOffer: () => Effect.succeed({ type: 'offer', sdp: offerSdp }),
        });

        yield* fixture.openRoom(bob);
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
        yield* fixture.openRoomEvents();
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
            'RoomEventsReady',
            'PeerInterrupted',
            'PeerRestored',
            'RoomEventsReady',
            'SasReady',
          ],
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a duplicate data-channel opened event', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.openRoomEvents();

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'RoomEventsReady'),
          1,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a data-channel opened event for an unknown channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        const unknownDataChannel: DataChannelHandle = {
          value: { label: ROOM_EVENTS_CHANNEL_LABEL } satisfies TestDataChannel,
        };

        yield* fixture.openRoom(bob);
        yield* fixture.actor({ _tag: 'DataChannelOpened', dataChannel: unknownDataChannel });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'RoomEventsReady'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );
});

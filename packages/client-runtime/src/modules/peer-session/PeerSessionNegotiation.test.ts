import { assert, describe, it } from '@effect/vitest';
import {
  IceCandidateSignal,
  JoinCancelledEvent,
  JoinRequestedEvent,
  PeerJoinedEvent,
  PeerLeftEvent,
  SessionDescriptionSignal,
  SignalReceivedEvent,
  type RoomEvent,
} from '@tether/contracts/modules/room';
import { Effect, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import { AppSignalingClient } from '../../AppSignalingClient';
import { startPeerSession } from '../room/PeerSessionHost';
import { type DataChannelHandle, type PeerSessionEvent } from './Model';
import { PlatformError } from './Platform';
import { ROOM_EVENTS_CHANNEL_LABEL } from './RoomEvents';
import {
  bob,
  bobName,
  charlie,
  makePeerSessionTestHarness,
  openedEvent,
  roomOpened,
  session,
  type TestDataChannel,
} from './test/PeerSessionTestHarness';

describe('peer-session actor', () => {
  const fingerprintSdp = (fingerprint: string) =>
    ['v=0', `a=fingerprint:sha-256 ${fingerprint}`, ''].join('\r\n');
  const remoteOfferSdp = fingerprintSdp('AA:BB:CC:DD');
  const localAnswerSdp = fingerprintSdp('11:22:33:44');

  it.effect('surfaces a knock to the host and clears it when the joiner withdraws', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(null);
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
        const answererFixture = yield* makePeerSessionTestHarness(undefined, undefined, {
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

        const offererFixture = yield* makePeerSessionTestHarness(undefined, undefined, {
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
        const fixture = yield* makePeerSessionTestHarness();

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
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
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

        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness();
        const answer = new SignalReceivedEvent({
          peerId: bob,
          signal: new SessionDescriptionSignal({
            negotiationEpoch: 0,
            type: 'answer',
            sdp: 'remote-answer',
          }),
        });

        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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
          fixture.operations.filter(
            (operation) => operation === `createDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`,
          ),
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
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(null);
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
          fixture.operations.filter(
            (operation) => operation === `createDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`,
          ),
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.fromQueue(roomEventQueue)) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness();

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

        assert.deepStrictEqual(fixture.operations, [
          'acquirePeerConnection',
          'observePeerConnection',
          'addLocalTracks',
          `createDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`,
          `observeDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`,
          'createOffer',
          'setLocalDescription:offer:offer-sdp',
          'sendSignal:offer:offer-sdp',
          'setRemoteDescription:answer:remote-answer',
        ]);
        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'Connected', peerId: bob },
          { _tag: 'RoomEventsReady' },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('makes the incumbent the answerer and accepts the remote data channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        const remoteDataChannel: DataChannelHandle = {
          value: { label: ROOM_EVENTS_CHANNEL_LABEL } satisfies TestDataChannel,
        };

        yield* fixture.openRoom(null);
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
          `observeDataChannel:${ROOM_EVENTS_CHANNEL_LABEL}`,
        ]);
        assert.deepStrictEqual(fixture.events, [
          roomOpened,
          { _tag: 'WaitingForPeer' },
          { _tag: 'Connected', peerId: bob },
          { _tag: 'RoomEventsReady' },
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('answers only newer offer epochs', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(null);
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
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(null);
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
});

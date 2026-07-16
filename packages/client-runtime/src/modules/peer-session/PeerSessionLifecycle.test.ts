import { assert, describe, it } from '@effect/vitest';
import {
  JoinDenied,
  NoPendingJoin,
  PeerAlreadyJoined,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomFull,
  RoomNotFound,
  ServerAtCapacity,
  type RoomEvent,
} from '@tether/contracts/modules/room';
import { Deferred, Effect, Exit, Queue, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import { AppSignalingClient } from '../../AppSignalingClient';
import { startPeerSession, type PreparedMedia } from '../room/PeerSessionHost';
import { type MediaStreamHandle } from './Model';
import { PlatformError } from './Platform';
import {
  bob,
  charlie,
  makePeerSessionTestHarness,
  openedEvent,
  roomOpened,
  session,
  testSessionToken,
} from './test/PeerSessionTestHarness';

describe('startPeerSession', () => {
  it.effect('stops when signaling ends', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        assert.strictEqual(yield* fixture.actor({ _tag: 'SignalingEnded' }), 'stop');
      }),
    ),
  );

  it.effect('continues after an ordinary input', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        assert.strictEqual(
          yield* fixture.actor({ _tag: 'RoomSessionOpened', peerId: null }),
          'continue',
        );
      }),
    ),
  );

  it.effect('accepts ICE gathering completion for the active generation', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        const eventCount = fixture.events.length;

        assert.strictEqual(yield* fixture.gatheringComplete(), 'continue');
        assert.lengthOf(fixture.events, eventCount);
      }),
    ),
  );

  it.effect('ignores ICE gathering completion before a peer is known', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        assert.strictEqual(yield* fixture.gatheringComplete(), 'continue');
        assert.deepStrictEqual(fixture.events, []);
      }),
    ),
  );

  it.effect('ignores ICE gathering completion from a stale generation', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.connectionFailed();
        const eventCount = fixture.events.length;

        assert.strictEqual(yield* fixture.gatheringComplete(fixture.peerConnection), 'continue');
        assert.lengthOf(fixture.events, eventCount);
      }),
    ),
  );

  it.effect('uses the Google public STUN server for peer connection acquisition', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const offerSent = yield* Deferred.make<void>();
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(
              Stream.concat(Stream.never),
            )) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(
              Stream.concat(Stream.never),
            )) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness();

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

  it.effect('uses a prepared media handle and adopts its finalizer', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const fixture = yield* makePeerSessionTestHarness(
        (() => Stream.never) as AppSignalingClient['Service']['OpenRoomSession'],
      ).pipe(Scope.provide(scope));
      const preparedStream: MediaStreamHandle = { value: { id: 'prepared-media' } };
      const preparedMedia: PreparedMedia = {
        claim: Effect.acquireRelease(
          Effect.sync(() => {
            fixture.operations.push('claimPreparedMedia');
            return preparedStream;
          }),
          () => Effect.sync(() => fixture.operations.push('releasePreparedMedia')),
        ),
      };

      yield* startPeerSession(session, preparedMedia).pipe(
        Effect.provide(fixture.dependencies),
        Scope.provide(scope),
      );
      yield* Queue.take(fixture.eventQueue);
      const localStreamReady = yield* Queue.take(fixture.eventQueue);

      assert.deepStrictEqual(localStreamReady, {
        _tag: 'LocalStreamReady',
        stream: preparedStream,
      });
      assert.notInclude(fixture.operations, 'acquireLocalMedia');
      assert.include(fixture.operations, 'claimPreparedMedia');

      yield* Scope.close(scope, Exit.void);
      assert.lengthOf(
        fixture.operations.filter((operation) => operation === 'releasePreparedMedia'),
        1,
      );
    }),
  );

  it.effect('claims prepared media before subscribing to the room session stream', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const roomStreamSubscribed = yield* Deferred.make<void>();
      const fixture = yield* makePeerSessionTestHarness((() =>
        Stream.unwrap(
          Effect.gen(function* () {
            fixture.operations.push('openRoomSessionSubscribed');
            yield* Deferred.succeed(roomStreamSubscribed, undefined);
            return Stream.never;
          }),
        )) as AppSignalingClient['Service']['OpenRoomSession']).pipe(Scope.provide(scope));
      const preparedStream: MediaStreamHandle = { value: { id: 'prepared-media' } };
      const preparedMedia: PreparedMedia = {
        claim: Effect.acquireRelease(
          Effect.sync(() => {
            fixture.operations.push('claimPreparedMedia');
            return preparedStream;
          }),
          () => Effect.sync(() => fixture.operations.push('releasePreparedMedia')),
        ),
      };

      yield* startPeerSession(session, preparedMedia).pipe(
        Effect.provide(fixture.dependencies),
        Scope.provide(scope),
      );
      // Wait until the forked actor loop actually subscribes to the room stream.
      yield* Deferred.await(roomStreamSubscribed);

      // The prepared preview stream is already live on the platform side, so its
      // release finalizer must be adopted before any suspending work: the claim
      // has to precede the room session stream subscription. If it ran after,
      // a teardown in between would leak the camera and microphone.
      const claimIndex = fixture.operations.indexOf('claimPreparedMedia');
      const subscribeIndex = fixture.operations.indexOf('openRoomSessionSubscribed');
      assert.isAtLeast(claimIndex, 0);
      assert.isAtLeast(subscribeIndex, 0);
      assert.isBelow(claimIndex, subscribeIndex);

      // Tearing down without ever connecting still releases the prepared media.
      yield* Scope.close(scope, Exit.void);
      assert.lengthOf(
        fixture.operations.filter((operation) => operation === 'releasePreparedMedia'),
        1,
      );
    }),
  );

  it.effect('explicitly leaves the room at most once', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.make({
            event: openedEvent(null),
          }).pipe(
            Stream.concat(Stream.never),
          )) as AppSignalingClient['Service']['OpenRoomSession']);
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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.fromQueue(roomEventQueue)) as AppSignalingClient['Service']['OpenRoomSession']);
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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.make({
            event: openedEvent(null),
          })) as AppSignalingClient['Service']['OpenRoomSession']);

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
        const fixture = yield* makePeerSessionTestHarness();

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
        assert.isFalse(peerSession.sendAvatarPose({ x: 0, z: 0, yaw: 0, action: 'idle' }));
        assert.isFalse(peerSession.sendMediaState({ cameraOn: false, microphoneOn: false }));
      }),
    ),
  );

  it.effect('emits RoomJoinRejected when the room is full', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.fail(
            new RoomFull({ roomId: session.roomId }),
          )) as AppSignalingClient['Service']['OpenRoomSession']);

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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.fail(
            new RoomFull({ roomId: session.roomId }),
          )) as AppSignalingClient['Service']['OpenRoomSession']);

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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.fail(new ServerAtCapacity())) as AppSignalingClient['Service']['OpenRoomSession']);

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
      const fixture = yield* makePeerSessionTestHarness(
        (() => Stream.never) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.fail(
            new PeerAlreadyJoined({
              roomId: session.roomId,
              peerId: session.selfId,
            }),
          )) as AppSignalingClient['Service']['OpenRoomSession']);

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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.fail(
            new RoomNotFound({ roomId: session.roomId }),
          )) as AppSignalingClient['Service']['OpenRoomSession']);

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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.fail(new JoinDenied())) as AppSignalingClient['Service']['OpenRoomSession']);

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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.make({
            event: openedEvent(null),
          }).pipe(
            Stream.concat(Stream.never),
          )) as AppSignalingClient['Service']['OpenRoomSession']);
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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.fromQueue(roomEventQueue)) as AppSignalingClient['Service']['OpenRoomSession']);
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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.make({
              event: openedEvent(null),
            }).pipe(
              Stream.concat(Stream.never),
            )) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.make({
              event: openedEvent(null),
            }).pipe(
              Stream.concat(Stream.never),
            )) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness((() =>
          Stream.fail(
            new Error('signaling failed'),
          )) as unknown as AppSignalingClient['Service']['OpenRoomSession']);

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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(
              Stream.concat(Stream.never),
            )) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(
              Stream.concat(Stream.never),
            )) as AppSignalingClient['Service']['OpenRoomSession'],
          (() =>
            Effect.fail(
              new PeerNotInRoom({ roomId: session.roomId, peerId: session.selfId }),
            )) as AppSignalingClient['Service']['SendSignal'],
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

  it.effect('processes PeerLeft after room events become unavailable', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const roomEventQueue = yield* Queue.unbounded<{ readonly event: RoomEvent }>();
        const offerSent = yield* Deferred.make<void>();
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.fromQueue(roomEventQueue)) as AppSignalingClient['Service']['OpenRoomSession'],
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
          _tag: 'RoomEventsUnavailable',
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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.fromQueue(roomEventQueue)) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.fromQueue(roomEventQueue)) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(
              Stream.concat(Stream.never),
            )) as AppSignalingClient['Service']['OpenRoomSession'],
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
        const fixture = yield* makePeerSessionTestHarness(
          (() =>
            Stream.make({
              event: openedEvent(bob),
            }).pipe(
              Stream.concat(Stream.never),
            )) as AppSignalingClient['Service']['OpenRoomSession'],
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

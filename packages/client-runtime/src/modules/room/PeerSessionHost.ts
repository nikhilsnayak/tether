import {
  isJoinDenied,
  isNoPendingJoin,
  isPeerAlreadyJoined,
  isPeerNotInRoom,
  isRoomFull,
  isRoomNotFound,
  isServerAtCapacity,
  IceCandidateSignal,
  SessionDescriptionSignal,
  type RoomEvent,
  type RoomId,
  type PeerId,
} from '@tether/contracts/modules/room';
import { Cause, Deferred, Effect, Exit, Option, Queue, Scope, Stream } from 'effect';

import { AppClient } from '../../AppClient';
import type {
  PeerSessionInput,
  PeerSessionLocalInput,
  PeerSessionLocalInputDispatch,
} from '../peer-session/ActorModel';
import type { RoomSession } from '../peer-session/Model';
import { makePeerSessionActor } from '../peer-session/PeerSession';
import { GOOGLE_STUN_SERVERS, isPlatformError } from '../peer-session/Platform';
import {
  PeerSessionEventSink,
  PeerSessionPlatform,
  PeerSessionSignaling,
} from '../peer-session/Services';
import { translateRoomEventData } from './Translation';

export interface PeerSession {
  /** Enqueues a chat command; `true` means queued, not remotely delivered. */
  readonly sendMessage: (message: string) => boolean;
  /** Host admits or rejects a knocking joiner. */
  readonly respondToJoin: (peerId: PeerId, decision: 'allow' | 'deny') => Promise<void>;
  /** Explicitly releases room membership before the client tears down its transport. */
  readonly leave: () => Promise<void>;
}

/**
 * Hosts the serialized peer-session actor and owns its session-level resources.
 * Connection state transitions remain inside {@link makePeerSessionActor}.
 */
export const startPeerSession = Effect.fn('@tether/client-runtime/startPeerSession')(function* (
  session: RoomSession,
) {
  const client = yield* AppClient;
  const platform = yield* PeerSessionPlatform;
  const peerSessionEventSink = yield* PeerSessionEventSink;
  const sessionScope = yield* Scope.Scope;
  const mediaScope = yield* Scope.fork(sessionScope);
  const actorScope = yield* Scope.fork(sessionScope);
  const openedSession = yield* Deferred.make<{
    readonly roomId: RoomId;
    readonly sessionToken: string;
  }>();
  const localInputQueue = yield* Queue.unbounded<PeerSessionLocalInput>();
  const dispatchLocalInput: PeerSessionLocalInputDispatch = (input) => {
    Queue.offerUnsafe(localInputQueue, input);
  };

  const signaling = PeerSessionSignaling.of({
    sendSignal: (signal) =>
      Deferred.await(openedSession).pipe(
        Effect.flatMap(({ roomId, sessionToken }) =>
          client.SendSignal({
            selfId: session.selfId,
            roomId,
            sessionToken,
            signal:
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
                  }),
          }),
        ),
      ),
  });

  const translateRoomEvent = Effect.fnUntraced(function* (event: RoomEvent) {
    const translation = translateRoomEventData(event);
    if (translation.openedSession !== null) {
      yield* Deferred.succeed(openedSession, translation.openedSession);
    }
    if (translation.uiEvent !== null) {
      yield* peerSessionEventSink.emit(translation.uiEvent);
    }
    return translation.input === null ? Option.none() : Option.some(translation.input);
  });

  const roomInputStream = client.OpenRoomSession(session).pipe(
    Stream.mapEffect(({ event }) => translateRoomEvent(event)),
    Stream.flatMap((input) => (Option.isSome(input) ? Stream.succeed(input.value) : Stream.empty)),
    Stream.map((input) => input as PeerSessionInput),
  );

  const localInputStream = Stream.fromQueue(localInputQueue);

  yield* peerSessionEventSink.emit({ _tag: 'SessionStarted' });

  // Local camera + microphone outlive individual connection generations but
  // are released as soon as the session actor reaches a terminal state.
  const localStream = yield* platform.acquireLocalMedia.pipe(Scope.provide(mediaScope));
  yield* peerSessionEventSink.emit({ _tag: 'LocalStreamReady', stream: localStream });

  const actor = yield* makePeerSessionActor(
    session.selfId,
    localStream,
    GOOGLE_STUN_SERVERS,
    dispatchLocalInput,
  ).pipe(Effect.provideService(PeerSessionSignaling, signaling), Scope.provide(actorScope));

  const actorLoop = Stream.merge(roomInputStream, localInputStream, {
    haltStrategy: 'left',
  }).pipe(Stream.runForEach(actor.handleInput));

  yield* actorLoop.pipe(
    Effect.ensuring(Scope.close(actorScope, Exit.void)),
    Effect.ensuring(Queue.shutdown(localInputQueue)),
    Effect.onExit(
      Effect.fnUntraced(function* (exit) {
        yield* Scope.close(mediaScope, Exit.void);

        if (Exit.isSuccess(exit)) {
          yield* Effect.logInfo('Signaling stream ended');
          return yield* peerSessionEventSink.emit({ _tag: 'SignalingDisconnected' });
        }

        if (!Cause.hasInterruptsOnly(exit.cause)) {
          const maybeError = Cause.findErrorOption(exit.cause);

          if (Option.isSome(maybeError)) {
            const error = maybeError.value;

            if (isRoomFull(error)) {
              yield* Effect.logWarning('Room join rejected because room is full');
              return yield* peerSessionEventSink.emit({
                _tag: 'RoomJoinRejected',
                reason: 'room-full',
              });
            }

            if (isServerAtCapacity(error)) {
              yield* Effect.logWarning('Room join rejected because server is at capacity');
              return yield* peerSessionEventSink.emit({
                _tag: 'RoomJoinRejected',
                reason: 'server-at-capacity',
              });
            }

            if (isPeerAlreadyJoined(error)) {
              yield* Effect.logWarning(
                'Room join rejected because peer identity is already present',
              );
              return yield* peerSessionEventSink.emit({
                _tag: 'RoomJoinRejected',
                reason: 'peer-already-joined',
              });
            }

            if (isRoomNotFound(error)) {
              yield* Effect.logWarning('Room join rejected because the room does not exist');
              return yield* peerSessionEventSink.emit({
                _tag: 'RoomJoinRejected',
                reason: 'room-not-found',
              });
            }

            if (isJoinDenied(error)) {
              yield* Effect.logWarning('Room join rejected because the host declined');
              return yield* peerSessionEventSink.emit({
                _tag: 'RoomJoinRejected',
                reason: 'join-denied',
              });
            }

            if (isPeerNotInRoom(error)) {
              yield* Effect.logWarning('Signaling rejected because peer is no longer in room');
              return yield* peerSessionEventSink.emit({
                _tag: 'SignalingDisconnected',
              });
            }

            if (isPlatformError(error)) {
              yield* Effect.logError('Peer session failed during platform operation', error).pipe(
                Effect.annotateLogs('operation', error.operation),
              );
              return yield* peerSessionEventSink.emit({ _tag: 'SessionFailed' });
            }
          }

          yield* Effect.logError('Peer session failed', exit.cause);
          return yield* peerSessionEventSink.emit({ _tag: 'SessionFailed' });
        }
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );

  let leavePromise: Promise<void> | undefined;
  const leaveEffect = Deferred.await(openedSession).pipe(
    Effect.flatMap(({ roomId, sessionToken }) =>
      client.LeaveRoom({ selfId: session.selfId, roomId, sessionToken }),
    ),
  );

  return {
    sendMessage: (message) =>
      Queue.offerUnsafe(localInputQueue, {
        _tag: 'SendMessage',
        message,
      }),
    respondToJoin: (peerId, decision) =>
      Effect.runPromise(
        Deferred.await(openedSession).pipe(
          Effect.flatMap(({ roomId, sessionToken }) =>
            client.RespondToJoin({
              roomId,
              selfId: session.selfId,
              sessionToken,
              peerId,
              decision,
            }),
          ),
          Effect.catchIf(isNoPendingJoin, (error) =>
            Effect.logWarning('Join decision could not be delivered').pipe(
              Effect.annotateLogs('reason', String(error)),
            ),
          ),
          Effect.tap(() => peerSessionEventSink.emit({ _tag: 'JoinRequestHandled', peerId })),
        ),
      ),
    leave: () => {
      leavePromise ??= Effect.runPromise(leaveEffect);
      return leavePromise;
    },
  } satisfies PeerSession;
});

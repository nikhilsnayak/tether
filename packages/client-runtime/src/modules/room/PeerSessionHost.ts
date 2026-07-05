import {
  isPeerAlreadyJoined,
  isPeerNotInRoom,
  isRoomFull,
  isServerAtCapacity,
} from '@tether/contracts/modules/room';
import { Cause, Effect, Exit, Option, Queue, Ref, Scope, Stream } from 'effect';

import { AppClient } from '../../AppClient';
import { makePeerSessionActor } from './PeerSession';
import type {
  PeerSessionInput,
  PeerSessionLocalInput,
  PeerSessionLocalInputDispatch,
} from './PeerSessionActorModel';
import { GOOGLE_STUN_SERVERS, isPlatformError, type RoomSession } from './PeerSessionModel';
import { PeerSessionEventSink, PeerSessionPlatform } from './PeerSessionServices';

export interface PeerSession {
  /** Enqueues a chat command; `true` means queued, not remotely delivered. */
  readonly sendMessage: (message: string) => boolean;
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
  const localInputQueue = yield* Queue.unbounded<PeerSessionLocalInput>();
  const dispatchLocalInput: PeerSessionLocalInputDispatch = (input) => {
    Queue.offerUnsafe(localInputQueue, input);
  };

  const roomInputStream = client.OpenRoomSession(session).pipe(
    Stream.map(
      ({ event }): PeerSessionInput => ({
        _tag: 'RoomEvent',
        event,
      }),
    ),
  );

  const localInputStream = Stream.fromQueue(localInputQueue);

  yield* peerSessionEventSink.emit({ _tag: 'SessionStarted' });

  // Local camera + microphone outlive individual connection generations but
  // are released as soon as the session actor reaches a terminal state.
  const localStream = yield* platform.acquireLocalMedia.pipe(Scope.provide(mediaScope));
  yield* peerSessionEventSink.emit({ _tag: 'LocalStreamReady', stream: localStream });

  const actor = yield* makePeerSessionActor(
    session,
    localStream,
    GOOGLE_STUN_SERVERS,
    dispatchLocalInput,
  ).pipe(Scope.provide(actorScope));

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

  return {
    sendMessage: (message) =>
      Queue.offerUnsafe(localInputQueue, {
        _tag: 'SendMessage',
        message,
      }),
    leave: () => {
      leavePromise ??= Effect.runPromise(
        Ref.get(actor.sessionTokenRef).pipe(
          Effect.flatMap((sessionToken) => client.LeaveRoom({ ...session, sessionToken })),
        ),
      );
      return leavePromise;
    },
  } satisfies PeerSession;
});

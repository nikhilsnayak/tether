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
  type SessionToken,
} from '@tether/contracts/modules/room';
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Ref,
  Scope,
  Stream,
} from 'effect';

import { AppSignalingClient } from '../../AppSignalingClient';
import type { PeerSessionInput, PeerSessionLocalInputDispatch } from '../peer-session/ActorModel';
import type { MediaStreamHandle, RoomSession } from '../peer-session/Model';
import { makePeerSessionActor } from '../peer-session/PeerSession';
import { GOOGLE_STUN_SERVERS, isPlatformError, type PlatformError } from '../peer-session/Platform';
import type { AvatarPose, MediaState } from '../peer-session/RoomEvents';
import {
  PeerSessionEventSink,
  PeerSessionPlatform,
  PeerSessionSignaling,
} from '../peer-session/Services';
import type { PreparedSourceHandle, WatchCapabilities } from '../watch-along/Model';
import type { WatchControlCommand } from '../watch-along/Protocol';
import {
  WatchAlongPlatform,
  WatchEventSink,
  WatchLocalCapabilities,
  WatchPlatformError,
  type WatchPlatformOperation,
} from '../watch-along/Services';
import { translateRoomEventData } from './Translation';

export interface PeerSession {
  /** Enqueues a chat command; `true` means queued, not remotely delivered. */
  readonly sendMessage: (message: string) => boolean;
  /** Enqueues the latest locally owned avatar pose; `true` means queued. */
  readonly sendAvatarPose: (pose: AvatarPose) => boolean;
  /** Enqueues the latest local camera/microphone state; `true` means queued. */
  readonly sendMediaState: (mediaState: MediaState) => boolean;
  readonly watch: {
    /** Transfers provisional source ownership only when the command is queued. */
    readonly propose: (source: PreparedSourceHandle) => boolean;
    readonly control: (control: WatchControlCommand) => boolean;
    readonly cancel: () => boolean;
  };
  /** Host admits or rejects a knocking joiner. */
  readonly respondToJoin: (peerId: PeerId, decision: 'allow' | 'deny') => Promise<void>;
  /** Notifies the peer directly after detachment; otherwise releases server membership. */
  readonly leave: () => Promise<void>;
}

/** A platform-owned local stream whose finalizer is adopted by the session media scope. */
export interface PreparedMedia {
  readonly claim: Effect.Effect<MediaStreamHandle, PlatformError, Scope.Scope>;
  /** Initial camera/microphone snapshot retained until the room-events channel opens. */
  readonly initialState?: MediaState;
}

export class PeerSessionSignalingTransport extends Context.Service<
  PeerSessionSignalingTransport,
  {
    readonly acquire: Effect.Effect<AppSignalingClient['Service'], never, Scope.Scope>;
  }
>()('@tether/client-runtime/peer-session/PeerSessionSignalingTransport') {}

/** Configures a fresh signaling transport that each peer session owns and can close. */
export const makePeerSessionSignalingLayer = (url: string) =>
  Layer.succeed(PeerSessionSignalingTransport, {
    acquire: Effect.suspend(() =>
      Layer.build(AppSignalingClient.layer(url)).pipe(
        Effect.map((context) => Context.get(context, AppSignalingClient)),
      ),
    ),
  });

const disabledWatchCapabilities: WatchCapabilities = {
  canPresentLocalFile: false,
  canReceiveProgramMedia: false,
  canRenderWatch: false,
  canControlWatch: false,
};

const disabledWatchOperation = (operation: WatchPlatformOperation) =>
  Effect.fail(new WatchPlatformError({ operation, cause: 'watch platform unavailable' }));

const disabledWatchPlatform = WatchAlongPlatform.of({
  cancelPreparedSource: () => disabledWatchOperation('cancel-prepared-source'),
  claimSource: () => disabledWatchOperation('claim-source'),
  programStream: () => disabledWatchOperation('program-stream'),
  play: () => disabledWatchOperation('play'),
  pause: () => disabledWatchOperation('pause'),
  seek: () => disabledWatchOperation('seek'),
  observeSource: () => disabledWatchOperation('observe-source'),
  primeFirstFrame: () => disabledWatchOperation('prime-first-frame'),
  attachProgramTracks: () => disabledWatchOperation('attach-program-tracks'),
  clearProgramTracks: disabledWatchOperation('clear-program-tracks'),
});

const noopWatchEventSink = WatchEventSink.of({ emit: () => Effect.void });

/**
 * Hosts the serialized peer-session actor and owns its session-level resources.
 * Signaling has a child scope that closes on detachment while actor, media, and
 * WebRTC resources remain owned by the parent session scope. Connection state
 * transitions remain inside {@link makePeerSessionActor}.
 */
export const startPeerSession = Effect.fn('@tether/client-runtime/startPeerSession')(function* (
  session: RoomSession,
  preparedMedia?: PreparedMedia,
) {
  const transport = yield* PeerSessionSignalingTransport;
  const platform = yield* PeerSessionPlatform;
  const peerSessionEventSink = yield* PeerSessionEventSink;
  const watchPlatform = Option.getOrElse(
    yield* Effect.serviceOption(WatchAlongPlatform),
    () => disabledWatchPlatform,
  );
  const watchEventSink = Option.getOrElse(
    yield* Effect.serviceOption(WatchEventSink),
    () => noopWatchEventSink,
  );
  const watchCapabilities = Option.getOrElse(
    yield* Effect.serviceOption(WatchLocalCapabilities),
    () => disabledWatchCapabilities,
  );
  const sessionScope = yield* Scope.Scope;
  const signalingScope = yield* Scope.fork(sessionScope);
  const client = yield* transport.acquire.pipe(Scope.provide(signalingScope));
  const mediaScope = yield* Scope.fork(sessionScope);
  const actorScope = yield* Scope.fork(sessionScope);

  // Claim local media before any suspending work so its finalizer is registered
  // in mediaScope up front. A prepared preview stream is already live on the
  // platform side; if the session scope closed before this claim ran, its
  // teardown would leak. Camera + microphone outlive individual connection
  // generations and are released once the session reaches a terminal state.
  const localStream = yield* (preparedMedia?.claim ?? platform.acquireLocalMedia).pipe(
    Scope.provide(mediaScope),
  );

  const openedSession = yield* Deferred.make<{
    readonly roomId: RoomId;
    readonly sessionToken: SessionToken;
  }>();
  const mailbox = yield* Queue.unbounded<PeerSessionInput>();
  let acceptingInputs = true;
  const detachedSignal = yield* Deferred.make<void>();
  const dispatchLocalInput: PeerSessionLocalInputDispatch = (input) => {
    Queue.offerUnsafe(mailbox, input);
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
    sendReadyToDetach: (negotiationEpoch) =>
      Deferred.await(openedSession).pipe(
        Effect.flatMap(({ roomId, sessionToken }) =>
          client.ReadyToDetach({
            selfId: session.selfId,
            roomId,
            sessionToken,
            negotiationEpoch,
          }),
        ),
      ),
  });

  const actorEventSink = PeerSessionEventSink.of({
    emit: (event) =>
      event._tag === 'SessionDetached'
        ? peerSessionEventSink
            .emit(event)
            .pipe(Effect.andThen(Deferred.succeed(detachedSignal, undefined)))
        : peerSessionEventSink.emit(event),
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

  yield* peerSessionEventSink.emit({ _tag: 'SessionStarted' });
  yield* peerSessionEventSink.emit({ _tag: 'LocalStreamReady', stream: localStream });

  const actor = yield* makePeerSessionActor(
    session.selfId,
    localStream,
    GOOGLE_STUN_SERVERS,
    dispatchLocalInput,
    {
      role: session.intent === 'host' ? 'host' : 'guest',
      capabilities: watchCapabilities,
      platform: watchPlatform,
      sink: watchEventSink,
    },
    preparedMedia?.initialState ?? null,
  ).pipe(
    Effect.provideService(PeerSessionSignaling, signaling),
    Effect.provideService(PeerSessionEventSink, actorEventSink),
    Scope.provide(actorScope),
  );

  yield* Deferred.await(detachedSignal).pipe(
    Effect.andThen(Scope.close(signalingScope, Exit.void)),
    Effect.forkScoped({ startImmediately: true }),
  );

  const signalingExit = yield* Ref.make<Exit.Exit<void, unknown>>(Exit.void);
  yield* client.OpenRoomSession(session).pipe(
    Stream.mapEffect(({ event }) => translateRoomEvent(event)),
    Stream.flatMap((input) => (Option.isSome(input) ? Stream.succeed(input.value) : Stream.empty)),
    Stream.runForEach((input) => Queue.offer(mailbox, input)),
    Effect.onExit((exit) =>
      Ref.set(signalingExit, exit).pipe(
        Effect.andThen(Queue.offer(mailbox, { _tag: 'SignalingEnded' })),
        Effect.ignore,
      ),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );

  const actorLoop = Stream.fromQueue(mailbox).pipe(
    Stream.mapEffect(actor.handleInput),
    Stream.takeUntil((outcome) => outcome === 'stop'),
    Stream.runDrain,
  );

  const closeActorHost = Effect.gen(function* () {
    acceptingInputs = false;
    yield* Scope.close(actorScope, Exit.void);
    const queued = yield* Queue.clear(mailbox);
    for (const input of queued) {
      if (input._tag !== 'WatchProposeSource') continue;
      yield* watchPlatform
        .cancelPreparedSource(input.source)
        .pipe(
          Effect.catchTag('WatchPlatformError', (error) =>
            Effect.logWarning(
              'Failed to release a queued watch source during session teardown',
            ).pipe(Effect.annotateLogs('operation', error.operation)),
          ),
        );
    }
    yield* Queue.shutdown(mailbox);
  });

  yield* actorLoop.pipe(
    Effect.ensuring(closeActorHost),
    Effect.onExit(
      Effect.fnUntraced(function* (exit) {
        yield* Scope.close(mediaScope, Exit.void);
        const causeExit = Exit.isSuccess(exit) ? yield* Ref.get(signalingExit) : exit;

        if (Exit.isSuccess(causeExit)) {
          return yield* peerSessionEventSink.emit({ _tag: 'SignalingDisconnected' });
        }

        if (!Cause.hasInterruptsOnly(causeExit.cause)) {
          const maybeError = Cause.findErrorOption(causeExit.cause);

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

          yield* Effect.logError('Peer session failed', causeExit.cause);
          return yield* peerSessionEventSink.emit({ _tag: 'SessionFailed' });
        }
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );

  let leavePromise: Promise<void> | undefined;
  const leaveEffect = Effect.gen(function* () {
    if (yield* Deferred.isDone(detachedSignal)) {
      Queue.offerUnsafe(mailbox, { _tag: 'SendLeave' });
      return;
    }
    if (!(yield* Deferred.isDone(openedSession))) return;
    const { roomId, sessionToken } = yield* Deferred.await(openedSession);
    yield* client.LeaveRoom({ selfId: session.selfId, roomId, sessionToken });
  });

  return {
    sendMessage: (message) =>
      acceptingInputs &&
      Queue.offerUnsafe(mailbox, {
        _tag: 'SendMessage',
        message,
      }),
    sendAvatarPose: (pose) =>
      acceptingInputs &&
      Queue.offerUnsafe(mailbox, {
        _tag: 'SendAvatarPose',
        pose,
      }),
    sendMediaState: (mediaState) =>
      acceptingInputs &&
      Queue.offerUnsafe(mailbox, {
        _tag: 'SendMediaState',
        mediaState,
      }),
    watch: {
      propose: (source) =>
        acceptingInputs && Queue.offerUnsafe(mailbox, { _tag: 'WatchProposeSource', source }),
      control: (control) =>
        acceptingInputs && Queue.offerUnsafe(mailbox, { _tag: 'WatchRequestControl', control }),
      cancel: () => acceptingInputs && Queue.offerUnsafe(mailbox, { _tag: 'WatchCancel' }),
    },
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

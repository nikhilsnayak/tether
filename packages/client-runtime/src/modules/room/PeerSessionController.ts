import { Effect, Schema, Scope } from 'effect';

import type { AvatarPose, MediaState } from '../peer-session/RoomEvents';
import type { PreparedSourceHandle } from '../watch-along/Model';
import type { WatchControlCommand } from '../watch-along/Protocol';
import type { PeerSession } from './PeerSessionHost';

export class PeerSessionUnavailableError extends Schema.TaggedErrorClass<PeerSessionUnavailableError>()(
  '@tether/PeerSessionUnavailableError',
  {},
) {}

export class PeerSessionControllerAlreadyActive extends Schema.TaggedErrorClass<PeerSessionControllerAlreadyActive>()(
  '@tether/PeerSessionControllerAlreadyActive',
  {},
) {}

export type PeerSessionCommandResult = 'unavailable' | 'queued' | 'closed';

export interface PeerSessionController {
  readonly isActive: () => boolean;
  readonly sendMessage: (message: string) => PeerSessionCommandResult;
  readonly sendAvatarPose: (pose: AvatarPose) => PeerSessionCommandResult;
  readonly sendMediaState: (state: MediaState) => PeerSessionCommandResult;
  readonly watch: {
    readonly propose: (source: PreparedSourceHandle) => PeerSessionCommandResult;
    readonly control: (control: WatchControlCommand) => PeerSessionCommandResult;
    readonly cancel: () => PeerSessionCommandResult;
    readonly failPipeline: (reason: 'renderer' | 'pipeline') => PeerSessionCommandResult;
  };
  readonly respondToJoin: PeerSession['respondToJoin'];
  readonly leave: PeerSession['leave'];
}

export interface PeerSessionControllerBinding {
  readonly controller: PeerSessionController;
  readonly getSnapshot: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly activate: (
    session: PeerSession,
  ) => Effect.Effect<PeerSession, PeerSessionControllerAlreadyActive, Scope.Scope>;
}

export const makePeerSessionControllerBinding = (): PeerSessionControllerBinding => {
  let activeSession: PeerSession | null = null;
  const listeners = new Set<() => void>();
  let publishScheduled = false;

  // Activation can run inside a React render (suspense evaluates the session
  // atom while rendering), so the snapshot mutates synchronously but listener
  // notification is deferred to a microtask.
  const publish = () => {
    if (publishScheduled) return;
    publishScheduled = true;
    void Promise.resolve().then(() => {
      publishScheduled = false;
      const currentListeners = Array.from(listeners);
      for (const listener of currentListeners) listener();
    });
  };

  const getSnapshot = () => activeSession !== null;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const send = (command: (session: PeerSession) => boolean): PeerSessionCommandResult => {
    if (activeSession === null) return 'unavailable';
    return command(activeSession) ? 'queued' : 'closed';
  };

  const unavailable = (): Promise<never> => Promise.reject(new PeerSessionUnavailableError());

  const controller: PeerSessionController = {
    isActive: () => activeSession !== null,
    sendMessage: (message) => send((session) => session.sendMessage(message)),
    sendAvatarPose: (pose) => send((session) => session.sendAvatarPose(pose)),
    sendMediaState: (state) => send((session) => session.sendMediaState(state)),
    watch: {
      propose: (source) => send((session) => session.watch.propose(source)),
      control: (control) => send((session) => session.watch.control(control)),
      cancel: () => send((session) => session.watch.cancel()),
      failPipeline: (reason) => send((session) => session.watch.failPipeline(reason)),
    },
    respondToJoin: (peerId, decision) =>
      activeSession === null ? unavailable() : activeSession.respondToJoin(peerId, decision),
    leave: () => (activeSession === null ? unavailable() : activeSession.leave()),
  };

  const activate = Effect.fn('@tether/client-runtime/PeerSessionController.activate')(function* (
    session: PeerSession,
  ): Effect.fn.Return<PeerSession, PeerSessionControllerAlreadyActive, Scope.Scope> {
    if (activeSession !== null) return yield* new PeerSessionControllerAlreadyActive();

    return yield* Effect.acquireRelease(
      Effect.sync(() => {
        activeSession = session;
        publish();
        return session;
      }),
      (acquiredSession) =>
        Effect.sync(() => {
          /* v8 ignore next -- guards a stale release when a concurrent activation replaced the session; unreachable through the single-activation API */
          if (activeSession !== acquiredSession) return;
          activeSession = null;
          publish();
        }),
    );
  });

  return { controller, getSnapshot, subscribe, activate };
};

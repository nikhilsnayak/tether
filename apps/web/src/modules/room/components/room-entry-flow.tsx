import { CatchBoundary } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { Suspense, useEffect, useReducer, useRef } from 'react';

import { initialRoomEntryState, roomEntryReducer } from '../entry/room-entry-state';
import type { PreparedMediaSelection } from '../preflight/media';
import { MediaSetupPanel } from '../preflight/media-setup-panel';
import type { RoomTemplate } from '../templates/registry';
import { CallLoadingScreen, SessionAcquisitionErrorScreen } from './call-status-screens';
import { PeerSessionLayer } from './peer-session-layer';
import { RoomExperience } from './room-experience';

const mediaSetupCopy = (intent: RoomSession['intent']) =>
  intent === 'join'
    ? 'You are outside the private room. Check your camera and microphone before knocking; this preview is never sent.'
    : "You're in your room. Check your camera and microphone, then invite someone to join. This preview is never sent.";

export function RoomEntryFlow({
  session,
  template,
  actionLabel,
  onLeave,
}: {
  readonly session: RoomSession;
  readonly template: RoomTemplate;
  readonly actionLabel: string;
  readonly onLeave: () => void;
}) {
  const [state, dispatch] = useReducer(roomEntryReducer, initialRoomEntryState);
  // session.selfId is stable for the page, so it can never trigger the error
  // boundary's auto-reset. A monotonic attempt counter gives each retry a fresh
  // reset key, so the boundary clears even if a retry keeps the subtree mounted.
  const attempt = useRef(0);

  const prepareMedia = (preparedMedia: PreparedMediaSelection) => {
    // The reducer rejects a duplicate without disposing, and nobody else would
    // release these tracks, so release a selection that arrives off-stage here.
    if (state._tag === 'MediaSetup') {
      dispatch({ _tag: 'MediaPrepared', preparedMedia });
    } else {
      void preparedMedia.release();
    }
  };

  return (
    <RoomExperience session={session} template={template} entryStage={state._tag}>
      {state._tag === 'MediaSetup' ? (
        <MediaSetupPanel
          template={template}
          description={mediaSetupCopy(session.intent)}
          actionLabel={actionLabel}
          onBack={onLeave}
          onComplete={prepareMedia}
        />
      ) : (
        <SessionRequestedStage
          session={session}
          preparedMedia={state.preparedMedia}
          resetKey={attempt.current}
          onLeaveRoom={onLeave}
          onRestartMediaSetup={() => {
            attempt.current += 1;
            dispatch({ _tag: 'RestartMediaSetup' });
          }}
        />
      )}
    </RoomExperience>
  );
}

// Commits above the suspending session child so it can own the transferred
// selection's release. The release is deferred and cancellable: StrictMode runs
// mount -> cleanup -> mount, and a synchronous release would race the claim
// still in flight inside the forked session scope.
function SessionRequestedStage({
  session,
  preparedMedia,
  resetKey,
  onLeaveRoom,
  onRestartMediaSetup,
}: {
  readonly session: RoomSession;
  readonly preparedMedia: PreparedMediaSelection;
  readonly resetKey: number;
  readonly onLeaveRoom: () => void;
  readonly onRestartMediaSetup: () => void;
}) {
  const pendingRelease = useRef<{
    media: PreparedMediaSelection;
    handle: ReturnType<typeof setTimeout>;
  } | null>(null);

  useEffect(() => {
    const pending = pendingRelease.current;
    if (pending !== null && pending.media === preparedMedia) {
      clearTimeout(pending.handle);
      pendingRelease.current = null;
    }
    return () => {
      pendingRelease.current = {
        media: preparedMedia,
        handle: setTimeout(() => void preparedMedia.release(), 0),
      };
    };
  }, [preparedMedia]);

  const restart = () => {
    void preparedMedia.release();
    onRestartMediaSetup();
  };

  return (
    <CatchBoundary
      errorComponent={({ error }) => (
        <SessionAcquisitionErrorScreen error={error} onRestartMediaSetup={restart} />
      )}
      getResetKey={() => String(resetKey)}
    >
      <Suspense fallback={<CallLoadingScreen />}>
        <PeerSessionLayer
          session={session}
          preparedMedia={preparedMedia}
          onLeaveRoom={onLeaveRoom}
        />
      </Suspense>
    </CatchBoundary>
  );
}

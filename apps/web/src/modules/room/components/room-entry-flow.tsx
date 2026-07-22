import { CatchBoundary } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { Suspense, useEffect, useReducer, useRef } from 'react';

import { initialRoomEntryState, roomEntryReducer } from '../entry/room-entry-state';
import { useProgramAudioPreferences } from '../hooks/use-program-audio-preferences';
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
  const { preferences: audioPreferences, setPreferences: setAudioPreferences } =
    useProgramAudioPreferences();
  // One record per entry attempt: `index` is the error boundary's reset key
  // (session.selfId is stable and never resets it), and `claimed` latches the
  // first accepted media synchronously so a racing completion can't slip past.
  const attempt = useRef({ index: 0, claimed: false });

  const prepareMedia = (preparedMedia: PreparedMediaSelection) => {
    // A ref settles synchronously, so a second completion racing the first
    // MediaPrepared dispatch releases its selection here rather than leaking
    // the tracks the reducer would silently drop.
    if (attempt.current.claimed) {
      void preparedMedia.release();
      return;
    }
    attempt.current.claimed = true;
    // Keep the chosen output and program volume, but never begin a new call muted.
    setAudioPreferences({ ...audioPreferences, speakerEnabled: true });
    dispatch({ _tag: 'MediaPrepared', preparedMedia });
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
          resetKey={attempt.current.index}
          onLeaveRoom={onLeave}
          onRestartMediaSetup={() => {
            attempt.current = { index: attempt.current.index + 1, claimed: false };
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

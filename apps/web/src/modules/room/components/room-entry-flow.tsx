import { CatchBoundary } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { Suspense, useReducer } from 'react';

import { initialRoomEntryState, roomEntryReducer } from '../entry/room-entry-state';
import { MediaSetupPanel } from '../preflight/media-setup-panel';
import type { RoomTemplate } from '../templates/registry';
import { CallErrorScreen, CallLoadingScreen } from './call-status-screens';
import { PeerSessionLayer } from './peer-session-layer';
import { RoomExperience } from './room-experience';

const mediaSetupCopy = (intent: RoomSession['intent']) =>
  intent === 'join'
    ? 'You are outside the private room. Check your camera and microphone before knocking; this preview is never sent.'
    : 'Check your default camera and microphone before entering. This preview is never sent.';

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

  return (
    <RoomExperience session={session} template={template} entryStage={state._tag}>
      {state._tag === 'MediaSetup' ? (
        <MediaSetupPanel
          template={template}
          description={mediaSetupCopy(session.intent)}
          actionLabel={actionLabel}
          onBack={onLeave}
          onComplete={(preparedMedia) => dispatch({ _tag: 'MediaPrepared', preparedMedia })}
        />
      ) : (
        <CatchBoundary errorComponent={CallErrorScreen} getResetKey={() => session.selfId}>
          <Suspense fallback={<CallLoadingScreen />}>
            <PeerSessionLayer
              session={session}
              preparedMedia={state.preparedMedia}
              onLeaveRoom={onLeave}
            />
          </Suspense>
        </CatchBoundary>
      )}
    </RoomExperience>
  );
}

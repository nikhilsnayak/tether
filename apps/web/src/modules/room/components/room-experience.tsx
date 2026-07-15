import { useAtomValue } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import {
  makePeerSessionControllerBinding,
  peerSessionViewAtom,
} from '@tether/client-runtime/modules/room';
import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { roomJourneyCue, type RoomJourneyCue } from '../scene/journey';
import { RoomScene } from '../scene/room-scene';
import type { RoomTemplate } from '../templates/registry';
import { RoomExperienceProvider } from './room-experience-context';

export function RoomExperience({
  session,
  template,
  sessionRequested,
  children,
}: {
  readonly session: RoomSession;
  readonly template: RoomTemplate;
  readonly sessionRequested: boolean;
  readonly children: ReactNode;
}) {
  const [binding] = useState(makePeerSessionControllerBinding);
  const active = useSyncExternalStore(binding.subscribe, binding.getSnapshot);
  const view = useAtomValue(peerSessionViewAtom);
  let journey: RoomJourneyCue;
  if (!sessionRequested) {
    journey = session.intent === 'join' ? 'outside' : 'waiting';
  } else if (!active) {
    journey = session.intent === 'join' ? 'outside' : 'connecting';
  } else {
    journey = roomJourneyCue(session.intent, view.status);
  }

  return (
    <RoomExperienceProvider binding={binding} journey={journey}>
      <div className='relative min-h-svh overflow-hidden'>
        <RoomScene
          template={template}
          admissionPending={active && view.pendingJoinRequests.length > 0}
          journey={journey}
          mode='call'
          sessionIntent={session.intent}
          remoteAvatarPose={active ? view.remoteAvatarPose : null}
          roomEventsReady={active && view.roomEventsReady}
          sendAvatarPose={(pose) => binding.controller.sendAvatarPose(pose) === 'queued'}
        />
        {children}
      </div>
    </RoomExperienceProvider>
  );
}

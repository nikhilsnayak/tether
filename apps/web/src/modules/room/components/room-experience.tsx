import { RegistryProvider, useAtomValue } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import {
  makePeerSessionControllerBinding,
  peerSessionViewAtom,
} from '@tether/client-runtime/modules/room';
import { useState, useSyncExternalStore, type ReactNode } from 'react';

import type { RoomEntryState } from '../entry/room-entry-state';
import { roomJourneyCue, type RoomJourneyCue } from '../scene/journey';
import { RoomScene } from '../scene/room-scene';
import type { RoomTemplate } from '../templates/registry';
import { RoomExperienceProvider } from './room-experience-context';

type RoomExperienceProps = {
  readonly session: RoomSession;
  readonly template: RoomTemplate;
  readonly entryStage: RoomEntryState['_tag'];
  readonly children: ReactNode;
};

// The nested registry scopes peer view/stream projections and the peer-session
// resource to this experience's lifetime, so they cannot outlive the room owner
// or leak across room attempts. Metadata queries stay in the app registry.
export function RoomExperience(props: RoomExperienceProps) {
  return (
    <RegistryProvider>
      <RoomExperienceOwner {...props} />
    </RegistryProvider>
  );
}

function RoomExperienceOwner({ session, template, entryStage, children }: RoomExperienceProps) {
  const [binding] = useState(makePeerSessionControllerBinding);
  const active = useSyncExternalStore(binding.subscribe, binding.getSnapshot);
  const view = useAtomValue(peerSessionViewAtom);
  let journey: RoomJourneyCue;
  if (entryStage === 'MediaSetup') {
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

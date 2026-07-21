import { RegistryProvider } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import type { ReactNode } from 'react';

import type { RoomEntryState } from '../entry/room-entry-state';
import { RoomScene } from '../scene/room-scene';
import type { RoomTemplate } from '../templates/registry';
import { WatchPanel } from '../watch-along/watch-panel';
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
export function RoomExperience({ session, template, entryStage, children }: RoomExperienceProps) {
  return (
    <RegistryProvider>
      <RoomExperienceProvider entryStage={entryStage}>
        <div className='relative min-h-svh overflow-hidden'>
          <RoomScene template={template} sessionIntent={session.intent} />
          {children}
          {template.watchAlong !== undefined && <WatchPanel />}
        </div>
      </RoomExperienceProvider>
    </RegistryProvider>
  );
}

import {
  makePeerSessionControllerBinding,
  type PeerSessionControllerBinding,
} from '@tether/client-runtime/modules/room';
import { createContext, use, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { RoomEntryState } from '../entry/room-entry-state';

interface RoomExperienceContextValue {
  readonly active: boolean;
  readonly binding: PeerSessionControllerBinding;
  readonly entryStage: RoomEntryState['_tag'];
  readonly watchAlongEnabled: boolean;
}

const RoomExperienceContext = createContext<RoomExperienceContextValue | null>(null);

export function useRoomExperience(): RoomExperienceContextValue {
  const value = use(RoomExperienceContext);
  if (value === null) {
    throw new Error('useRoomExperience must be used within RoomExperience');
  }
  return value;
}

export function RoomExperienceProvider({
  entryStage,
  watchAlongEnabled,
  children,
}: {
  readonly entryStage: RoomEntryState['_tag'];
  readonly watchAlongEnabled: boolean;
  readonly children: ReactNode;
}) {
  const [binding] = useState(makePeerSessionControllerBinding);
  const active = useSyncExternalStore(binding.subscribe, binding.getSnapshot);

  return (
    <RoomExperienceContext value={{ active, binding, entryStage, watchAlongEnabled }}>
      {children}
    </RoomExperienceContext>
  );
}

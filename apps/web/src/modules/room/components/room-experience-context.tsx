import type { PeerSessionControllerBinding } from '@tether/client-runtime/modules/room';
import { createContext, use, type ReactNode } from 'react';

import type { RoomJourneyCue } from '../scene/journey';

interface RoomExperienceContextValue {
  readonly binding: PeerSessionControllerBinding;
  readonly journey: RoomJourneyCue;
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
  binding,
  journey,
  children,
}: RoomExperienceContextValue & { readonly children: ReactNode }) {
  return <RoomExperienceContext value={{ binding, journey }}>{children}</RoomExperienceContext>;
}

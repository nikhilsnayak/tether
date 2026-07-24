import { createContext, use, type ReactNode, type RefObject } from 'react';

import { useLazyRef } from '@/hooks/use-lazy-ref';

import { createSpatialAudioState, type SpatialAudioState } from '../audio/spatial-audio-state';

interface SpatialAudioContextValue {
  readonly stateRef: RefObject<SpatialAudioState>;
  readonly screenPosition: readonly [number, number, number] | null;
}

const SpatialAudioContext = createContext<SpatialAudioContextValue | null>(null);

export function useSpatialAudio(): SpatialAudioContextValue {
  const value = use(SpatialAudioContext);
  if (value === null) {
    throw new Error('useSpatialAudio must be used within SpatialAudioProvider');
  }
  return value;
}

export function SpatialAudioProvider({
  screenPosition,
  children,
}: {
  readonly screenPosition: readonly [number, number, number] | null;
  readonly children: ReactNode;
}) {
  const stateRef = useLazyRef(createSpatialAudioState);
  const value = { stateRef, screenPosition };
  return <SpatialAudioContext value={value}>{children}</SpatialAudioContext>;
}

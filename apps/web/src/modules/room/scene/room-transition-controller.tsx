import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';

import { resolveRoomTransition, type RoomJourneyCue, type RoomTransition } from './journey';

export function RoomTransitionController({
  journey,
  reducedMotion,
  updateSpatialJourney,
}: {
  readonly journey: RoomJourneyCue;
  readonly reducedMotion: boolean;
  readonly updateSpatialJourney: (journey: RoomJourneyCue) => void;
}) {
  const transition = useRef<RoomTransition>({ kind: 'none', durationMs: 0 });
  const elapsedMs = useRef(0);
  const previousJourney = useRef(journey);
  const previousReducedMotion = useRef(reducedMotion);

  useFrame((_, delta) => {
    if (previousJourney.current !== journey || previousReducedMotion.current !== reducedMotion) {
      const nextTransition = resolveRoomTransition(
        transition.current,
        previousJourney.current,
        journey,
        reducedMotion,
      );
      if (nextTransition !== transition.current) {
        transition.current = nextTransition;
        elapsedMs.current = 0;
      }
      previousJourney.current = journey;
      previousReducedMotion.current = reducedMotion;
      if (nextTransition.kind === 'none') updateSpatialJourney(journey);
    }

    if (transition.current.kind !== 'enter') return;
    elapsedMs.current += delta * 1_000;
    if (elapsedMs.current < transition.current.durationMs) return;
    transition.current = { kind: 'none', durationMs: 0 };
    updateSpatialJourney(journey);
  });

  return null;
}

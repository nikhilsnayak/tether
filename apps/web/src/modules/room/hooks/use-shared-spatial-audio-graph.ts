import { useEffect, useState } from 'react';

import { isSpatialAudioSupported } from '../audio/spatial-audio';
import { createSpatialAudioGraph, type SpatialAudioGraph } from '../audio/spatial-audio-graph';
import { useSpatialAudio } from '../components/spatial-audio-context';
import { useProgramAudioPreferences } from './use-program-audio-preferences';

export function useSharedSpatialAudioGraph(): SpatialAudioGraph | null {
  const { stateRef, screenPosition } = useSpatialAudio();
  const { preferences } = useProgramAudioPreferences();
  const [activated, setActivated] = useState(false);
  const [graph, setGraph] = useState<SpatialAudioGraph | null>(null);

  // AudioContext resume needs a user gesture (same pattern as RemoteAudio).
  useEffect(() => {
    if (activated) return;
    const activate = () => setActivated(true);
    document.addEventListener('pointerdown', activate, { once: true, capture: true });
    document.addEventListener('keydown', activate, { once: true, capture: true });
    return () => {
      document.removeEventListener('pointerdown', activate, { capture: true });
      document.removeEventListener('keydown', activate, { capture: true });
    };
  }, [activated]);

  // D10: only Chromium keeps device selection once audio routes through Web Audio.
  // Elsewhere this stays null and callers fall back to plain <audio>.
  useEffect(() => {
    if (!activated || !isSpatialAudioSupported()) return;
    let created: SpatialAudioGraph | null = null;
    try {
      created = createSpatialAudioGraph();
    } catch {
      return;
    }
    setGraph(created);
    return () => {
      setGraph(null);
      created.dispose();
    };
  }, [activated]);

  // D7: if the Canvas unmounts on context loss the ref freezes and audio keeps
  // playing at last-known positions — frozen but audible, never silent.
  useEffect(() => {
    if (graph === null) return;
    const screen = screenPosition === null ? null : { x: screenPosition[0], z: screenPosition[2] };
    let frame = requestAnimationFrame(function tick() {
      const state = stateRef.current;
      graph.updateListener(state.listener.position, state.listener.orientation);
      graph.updateVoice(state.remote.position, state.remote.present, state.listener.position);
      if (screen !== null) graph.updateProgram(screen, state.listener.position);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [graph, screenPosition, stateRef]);

  useEffect(() => {
    graph?.setMasterMuted(!preferences.speakerEnabled);
  }, [graph, preferences.speakerEnabled]);
  useEffect(() => {
    graph?.setSinkId(preferences.sinkId);
  }, [graph, preferences.sinkId]);
  useEffect(() => {
    graph?.setProgramVolume(preferences.volume);
  }, [graph, preferences.volume]);

  return graph;
}

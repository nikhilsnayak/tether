import { useAtomValue } from '@effect/atom-react';
import { watchProgramStreamAtom } from '@tether/client-runtime/modules/watch-along';
import { useEffect, useRef } from 'react';

import type { SpatialAudioGraph } from '../audio/spatial-audio-graph';
import { attachAudioStream, setAudioSink } from '../components/audio-element';
import { useProgramAudioPreferences } from '../hooks/use-program-audio-preferences';
import { programMediaStreamValue } from './platform';

export function ProgramAudio({ graph }: { readonly graph: SpatialAudioGraph | null }) {
  const streamHandle = useAtomValue(watchProgramStreamAtom);
  const { preferences } = useProgramAudioPreferences();
  const audioRef = useRef<HTMLAudioElement>(null);
  const stream = streamHandle !== null ? programMediaStreamValue(streamHandle) : null;

  // In spatial mode the element is a muted keepalive (§6) attached whenever a
  // stream exists; in fallback it is the audible path, gated on speakerEnabled.
  useEffect(() => {
    const element = audioRef.current;
    if (element === null || stream === null) return;
    if (graph === null && !preferences.speakerEnabled) return;
    return attachAudioStream(element, stream);
  }, [graph, preferences.speakerEnabled, stream]);

  useEffect(() => {
    if (graph === null || stream === null) return;
    graph.connectProgram(stream);
  }, [graph, stream]);

  // Fallback only: the graph owns volume + sink in spatial mode.
  useEffect(() => {
    const element = audioRef.current;
    if (element === null || graph !== null) return;
    element.volume = preferences.volume;
    setAudioSink(element, preferences.sinkId);
  }, [graph, preferences.sinkId, preferences.volume]);

  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- live program audio has no captions
    <audio
      ref={audioRef}
      aria-label='Program audio'
      autoPlay
      muted={graph !== null ? true : !preferences.speakerEnabled}
    />
  );
}

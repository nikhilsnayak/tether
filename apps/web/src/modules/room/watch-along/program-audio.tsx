import { useAtomValue } from '@effect/atom-react';
import { watchProgramStreamAtom } from '@tether/client-runtime/modules/watch-along';
import { useEffect, useRef } from 'react';

import { attachAudioStream, setAudioSink } from '../components/audio-element';
import { useProgramAudioPreferences } from '../hooks/use-program-audio-preferences';
import { programMediaStreamValue } from './platform';

export function ProgramAudio() {
  const streamHandle = useAtomValue(watchProgramStreamAtom);
  const { preferences } = useProgramAudioPreferences();
  const audioRef = useRef<HTMLAudioElement>(null);
  const stream = streamHandle !== null ? programMediaStreamValue(streamHandle) : null;

  useEffect(() => {
    const element = audioRef.current;
    if (element === null || stream === null || !preferences.speakerEnabled) return;
    return attachAudioStream(element, stream);
  }, [preferences.speakerEnabled, stream]);

  useEffect(() => {
    const element = audioRef.current;
    if (element === null) return;
    element.volume = preferences.volume;
    setAudioSink(element, preferences.sinkId);
  }, [preferences.sinkId, preferences.volume]);

  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- live program audio has no captions
    <audio ref={audioRef} aria-label='Program audio' autoPlay muted={!preferences.speakerEnabled} />
  );
}

import { useAtomValue } from '@effect/atom-react';
import { watchProgramStreamAtom, watchViewAtom } from '@tether/client-runtime/modules/watch-along';
import { useEffect, useRef } from 'react';

import { useRoomExperience } from '../components/room-experience-context';
import { useProgramAudioPreferences } from '../hooks/use-program-audio-preferences';
import { attachReceivedProgramAudio, setReceivedProgramAudioSink } from './received-program-audio';

function ProgramAudio({
  stream,
  volume,
  sinkId,
  muted,
}: {
  readonly stream: MediaStream;
  readonly volume: number;
  readonly sinkId: string;
  readonly muted: boolean;
}) {
  const { binding } = useRoomExperience();
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = audioRef.current;
    if (element === null) return;

    let cancelled = false;
    let detach: () => void = () => undefined;
    const start = async () => {
      detach = attachReceivedProgramAudio(element, stream);
      await element.play();
    };
    void start().catch(() => {
      if (!cancelled) binding.controller.watch.failPipeline('pipeline');
    });

    return () => {
      cancelled = true;
      detach();
    };
  }, [binding, stream]);

  useEffect(() => {
    const element = audioRef.current;
    if (element === null) return;

    let cancelled = false;
    void setReceivedProgramAudioSink(element, sinkId).catch(() => {
      if (!cancelled) binding.controller.watch.failPipeline('pipeline');
    });
    return () => {
      cancelled = true;
    };
  }, [binding, sinkId]);

  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- live program audio has no captions
    <audio
      ref={(element) => {
        audioRef.current = element;
        if (element !== null) element.volume = volume;
      }}
      aria-label='Program audio'
      autoPlay
      hidden
      muted={muted}
      onError={() => binding.controller.watch.failPipeline('pipeline')}
    />
  );
}

export function ReceivedProgramAudioOutput() {
  const streamHandle = useAtomValue(watchProgramStreamAtom);
  const view = useAtomValue(watchViewAtom);
  const { preferences } = useProgramAudioPreferences();
  if (streamHandle === null || view.role !== 'watcher') return null;

  return (
    <ProgramAudio
      stream={streamHandle.value as MediaStream}
      volume={preferences.volume}
      sinkId={preferences.sinkId}
      muted={!preferences.speakerEnabled}
    />
  );
}

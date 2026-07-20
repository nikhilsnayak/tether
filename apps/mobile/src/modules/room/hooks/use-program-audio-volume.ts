import { useEffect } from 'react';
import type { MediaStream } from 'react-native-webrtc';

import { applyProgramAudioVolume } from '../watch-along/program-audio';
import { classifyProgramPipelineSignal } from '../watch-along/program-pipeline';

export function useProgramAudioVolume(
  stream: MediaStream | null,
  volume: number,
  failPipeline: (reason: 'renderer' | 'pipeline') => boolean,
  interrupted: boolean,
) {
  useEffect(() => {
    if (stream === null) return;
    return applyProgramAudioVolume(stream, volume, () => {
      const reason = classifyProgramPipelineSignal('audio-error', {
        active: true,
        interrupted,
        tearingDown: false,
      });
      if (reason !== null) failPipeline(reason);
    });
  }, [failPipeline, interrupted, stream, volume]);
}

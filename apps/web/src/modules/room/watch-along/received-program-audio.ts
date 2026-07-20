import { setAudioOutputSink } from './audio-output-sink';

export interface ReceivedProgramAudioElement {
  srcObject: HTMLMediaElement['srcObject'];
  readonly pause: () => void;
  readonly setSinkId?: (sinkId: string) => Promise<void>;
}

export const setReceivedProgramAudioSink = (
  element: ReceivedProgramAudioElement,
  selectedSinkId: string,
): Promise<void> => setAudioOutputSink(element, selectedSinkId);

export const attachReceivedProgramAudio = (
  element: ReceivedProgramAudioElement,
  source: MediaStream,
): (() => void) => {
  element.srcObject = new MediaStream(source.getAudioTracks());

  return () => {
    element.pause();
    element.srcObject = null;
  };
};

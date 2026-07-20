export interface AudioOutputSink {
  readonly setSinkId?: (sinkId: string) => Promise<void>;
}

export async function setAudioOutputSink(
  output: AudioOutputSink,
  selectedSinkId: string,
): Promise<void> {
  const sinkId = selectedSinkId === 'default' ? '' : selectedSinkId;
  if (output.setSinkId !== undefined) {
    await output.setSinkId(sinkId);
    return;
  }
  if (sinkId !== '') throw new Error('Selected audio output is unsupported');
}

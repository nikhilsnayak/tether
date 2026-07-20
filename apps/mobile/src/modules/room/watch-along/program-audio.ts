export interface NativeProgramAudioTrack {
  readonly _setVolume: (volume: number) => void;
}

export interface NativeProgramAudioStream {
  readonly getAudioTracks: () => ReadonlyArray<NativeProgramAudioTrack>;
}

export const applyProgramAudioVolume = (
  stream: NativeProgramAudioStream,
  volume: number,
  onFailure: () => void,
): (() => void) => {
  const tracks = stream.getAudioTracks();
  const apply = (nextVolume: number) => {
    try {
      for (const track of tracks) track._setVolume(nextVolume);
      return true;
    } catch {
      onFailure();
      return false;
    }
  };

  if (!apply(clampProgramVolume(volume))) return () => {};
  return () => void apply(1);
};

export const clampProgramVolume = (volume: number): number => Math.min(1, Math.max(0, volume));

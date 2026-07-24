export interface SpatialAudioState {
  readonly listener: {
    readonly position: { x: number; z: number };
    readonly orientation: { forwardX: number; forwardZ: number };
  };
  readonly remote: {
    readonly position: { x: number; z: number };
    present: boolean;
  };
}

export function createSpatialAudioState(): SpatialAudioState {
  return {
    listener: { position: { x: 0, z: 0 }, orientation: { forwardX: 0, forwardZ: 1 } },
    remote: { position: { x: 0, z: 0 }, present: false },
  };
}

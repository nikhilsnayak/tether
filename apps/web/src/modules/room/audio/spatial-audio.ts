export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface ListenerOrientation {
  readonly forwardX: number;
  readonly forwardZ: number;
}

export interface FalloffConfig {
  readonly refDistance: number;
  readonly maxDistance: number;
  // Minimum gain, so a source is never fully silent.
  readonly floor: number;
}

export const DEFAULT_FALLOFF: FalloffConfig = {
  refDistance: 1.5,
  maxDistance: 11,
  floor: 0.25,
};

// Gates spatial audio on setSinkId: routing through Web Audio forfeits
// HTMLMediaElement device selection, and only Chromium restores it here.
export function isSpatialAudioSupported(): boolean {
  if (typeof AudioContext === 'undefined') return false;
  return typeof (AudioContext.prototype as { setSinkId?: unknown }).setSinkId === 'function';
}

export function listenerForwardFromYaw(yaw: number): ListenerOrientation {
  return { forwardX: Math.sin(yaw), forwardZ: Math.cos(yaw) };
}

export function distance2d(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// Attenuation is computed here rather than by the PannerNode so the floor holds:
// PannerNode distance models asymptote toward 0, past which no gain recovers it.
export function spatialGain(distance: number, config: FalloffConfig): number {
  const { refDistance, maxDistance, floor } = config;
  if (distance <= refDistance) return 1;
  if (distance >= maxDistance) return floor;
  const t = (distance - refDistance) / (maxDistance - refDistance);
  return 1 - t * (1 - floor);
}

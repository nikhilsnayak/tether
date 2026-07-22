export type Vector3Tuple = readonly [x: number, y: number, z: number];

export interface CameraFraming {
  readonly position: Vector3Tuple;
  readonly target: Vector3Tuple;
  readonly fieldOfView: number;
}

export interface CameraOrbit {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
}

export interface CameraFramings {
  readonly landscape: CameraFraming;
  readonly portrait: CameraFraming;
  readonly outside: CameraFraming;
}

export type ResponsiveCameraFramings = Pick<CameraFramings, 'landscape' | 'portrait'>;

export interface CameraLookConfig {
  readonly yaw: readonly [minimum: number, maximum: number];
  readonly pitch: readonly [minimum: number, maximum: number];
  readonly recenterAfterMs: number;
  readonly recenterSeconds: number;
}

export type QualityPreference = 'auto' | 'high' | 'medium' | 'low';
export type ResolvedQualityTier = Exclude<QualityPreference, 'auto'>;

export interface QualityConfig {
  readonly dpr: readonly [minimum: number, maximum: number];
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly lightCount: number;
  readonly ambientDetail: boolean;
}

export interface RenderingQualitySettings {
  readonly canvas: {
    readonly dpr: [minimum: number, maximum: number];
    readonly shadows: boolean;
  };
}

export const ROOM_RENDERER_SETTINGS = {
  antialias: true,
  forceWebGL: false,
  powerPreference: 'high-performance',
} as const;

export interface AdaptiveQualityState {
  readonly tier: ResolvedQualityTier;
  readonly slowSamples: number;
  readonly fastSamples: number;
  readonly cooldownSamples: number;
}

export const QUALITY_CONFIGS: Readonly<Record<ResolvedQualityTier, QualityConfig>> = {
  high: {
    dpr: [1, 2],
    shadows: true,
    shadowMapSize: 2048,
    lightCount: 3,
    ambientDetail: true,
  },
  medium: {
    dpr: [1, 1.5],
    shadows: true,
    shadowMapSize: 1024,
    lightCount: 2,
    ambientDetail: true,
  },
  low: {
    dpr: [1, 1],
    shadows: false,
    shadowMapSize: 0,
    lightCount: 1,
    ambientDetail: false,
  },
};

export const QUALITY_STORAGE_KEY = 'tether.room.quality';

export function renderingQualitySettings(quality: QualityConfig): RenderingQualitySettings {
  return {
    canvas: { dpr: [...quality.dpr], shadows: quality.shadows },
  };
}

export function resolveQualityTier(
  preference: QualityPreference,
  devicePixelRatio: number,
): ResolvedQualityTier {
  if (preference !== 'auto') return preference;
  return devicePixelRatio > 1.5 ? 'medium' : 'high';
}

export function initialAdaptiveQualityState(devicePixelRatio: number): AdaptiveQualityState {
  return {
    tier: resolveQualityTier('auto', devicePixelRatio),
    slowSamples: 0,
    fastSamples: 0,
    cooldownSamples: 0,
  };
}

const cheaperTier = (tier: ResolvedQualityTier): ResolvedQualityTier =>
  tier === 'high' ? 'medium' : 'low';

const richerTier = (tier: ResolvedQualityTier): ResolvedQualityTier =>
  tier === 'low' ? 'medium' : 'high';

/** One sample represents roughly one second of rendered frames. */
export function sampleAdaptiveQuality(
  state: AdaptiveQualityState,
  framesPerSecond: number,
): AdaptiveQualityState {
  const cooldownSamples = Math.max(0, state.cooldownSamples - 1);
  const isSlow =
    (state.tier === 'high' && framesPerSecond < 50) ||
    (state.tier === 'medium' && framesPerSecond < 28);
  const isFast =
    (state.tier === 'low' && framesPerSecond > 42) ||
    (state.tier === 'medium' && framesPerSecond > 57);
  const slowSamples = isSlow ? state.slowSamples + 1 : 0;
  const fastSamples = isFast ? state.fastSamples + 1 : 0;

  if (cooldownSamples === 0 && slowSamples >= 3 && state.tier !== 'low') {
    return { tier: cheaperTier(state.tier), slowSamples: 0, fastSamples: 0, cooldownSamples: 8 };
  }
  if (cooldownSamples === 0 && fastSamples >= 12 && state.tier !== 'high') {
    return { tier: richerTier(state.tier), slowSamples: 0, fastSamples: 0, cooldownSamples: 8 };
  }
  return { ...state, slowSamples, fastSamples, cooldownSamples };
}

export function isQualityPreference(value: string | null): value is QualityPreference {
  return value === 'auto' || value === 'high' || value === 'medium' || value === 'low';
}

export function clampLook(
  yaw: number,
  pitch: number,
  config: CameraLookConfig,
): { readonly yaw: number; readonly pitch: number } {
  return {
    yaw: Math.min(config.yaw[1], Math.max(config.yaw[0], yaw)),
    pitch: Math.min(config.pitch[1], Math.max(config.pitch[0], pitch)),
  };
}

export function cameraOrbitFromPosition(
  position: { readonly x: number; readonly y: number; readonly z: number },
  focus: { readonly x: number; readonly z: number },
  cameraHeight: number,
  distanceBounds: { readonly minimum: number; readonly maximum: number },
): CameraOrbit {
  const offsetX = position.x - focus.x;
  const offsetZ = position.z - focus.z;
  const verticalOffset = position.y - cameraHeight;
  const horizontalDistance = Math.hypot(offsetX, offsetZ);
  return {
    yaw: Math.atan2(-offsetX, -offsetZ),
    pitch: Math.min(0.45, Math.max(-0.35, Math.atan2(verticalOffset, horizontalDistance))),
    distance: Math.min(
      distanceBounds.maximum,
      Math.max(distanceBounds.minimum, Math.hypot(horizontalDistance, verticalOffset)),
    ),
  };
}

export function selectCameraFraming(
  width: number,
  height: number,
  outside: boolean,
  framings: CameraFramings,
): CameraFraming {
  if (outside) return framings.outside;
  return selectResponsiveCameraFraming(width, height, framings);
}

export function selectResponsiveCameraFraming(
  width: number,
  height: number,
  framings: ResponsiveCameraFramings,
): CameraFraming {
  return width >= height ? framings.landscape : framings.portrait;
}

export function shouldAnimateCamera(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}

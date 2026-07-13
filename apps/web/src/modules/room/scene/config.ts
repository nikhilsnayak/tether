export type Vector3Tuple = readonly [x: number, y: number, z: number];

export interface CameraFraming {
  readonly position: Vector3Tuple;
  readonly target: Vector3Tuple;
  readonly fieldOfView: number;
}

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

export function selectFraming(
  width: number,
  height: number,
  landscape: CameraFraming,
  portrait: CameraFraming,
): CameraFraming {
  return width >= height ? landscape : portrait;
}

export function shouldAnimateCamera(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}

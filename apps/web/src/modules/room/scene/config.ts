export type Vector3Tuple = readonly [x: number, y: number, z: number];

export interface SceneTransform {
  readonly position: Vector3Tuple;
  readonly rotation: Vector3Tuple;
  readonly scale: Vector3Tuple;
}

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

export type SceneAnchorId = 'display' | 'console' | 'door' | 'window' | 'warmLight' | 'audio';

export type SceneAnchors = Readonly<Record<SceneAnchorId, SceneTransform>>;

export type QualityPreference = 'auto' | 'high' | 'medium' | 'low';
export type ResolvedQualityTier = Exclude<QualityPreference, 'auto'>;

export interface QualityConfig {
  readonly dpr: readonly [minimum: number, maximum: number];
  readonly antialias: boolean;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly lightCount: number;
  readonly ambientDetail: boolean;
}

export const QUALITY_CONFIGS: Readonly<Record<ResolvedQualityTier, QualityConfig>> = {
  high: {
    dpr: [1, 2],
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    lightCount: 3,
    ambientDetail: true,
  },
  medium: {
    dpr: [1, 1.5],
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    lightCount: 2,
    ambientDetail: true,
  },
  low: {
    dpr: [1, 1],
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    lightCount: 1,
    ambientDetail: false,
  },
};

export const QUALITY_STORAGE_KEY = 'tether.room.quality';

export function resolveQualityTier(
  preference: QualityPreference,
  devicePixelRatio: number,
): ResolvedQualityTier {
  if (preference !== 'auto') return preference;
  return devicePixelRatio > 1.5 ? 'medium' : 'high';
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

export function isFiniteTransform(transform: SceneTransform): boolean {
  return [...transform.position, ...transform.rotation, ...transform.scale].every(Number.isFinite);
}

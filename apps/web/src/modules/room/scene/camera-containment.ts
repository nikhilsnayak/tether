import type { GroundBounds } from './avatar-motion';

export interface CameraPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraVerticalBounds {
  readonly minY: number;
  readonly maxY: number;
}

const axisContainmentScale = (
  origin: number,
  desired: number,
  minimum: number,
  maximum: number,
): number => {
  const delta = desired - origin;
  if (delta < 0 && desired < minimum) return (minimum - origin) / delta;
  if (delta > 0 && desired > maximum) return (maximum - origin) / delta;
  return 1;
};

/**
 * Shortens the target-to-camera segment until its endpoint is inside the
 * configured ground and vertical bounds. Scaling the whole segment preserves
 * the requested orbit angle, unlike clamping each coordinate independently.
 */
export const cameraContainmentScale = (
  origin: CameraPoint,
  desired: CameraPoint,
  ground: GroundBounds,
  vertical: CameraVerticalBounds,
): number =>
  Math.max(
    0,
    Math.min(
      1,
      axisContainmentScale(origin.x, desired.x, ground.minX, ground.maxX),
      axisContainmentScale(origin.y, desired.y, vertical.minY, vertical.maxY),
      axisContainmentScale(origin.z, desired.z, ground.minZ, ground.maxZ),
    ),
  );

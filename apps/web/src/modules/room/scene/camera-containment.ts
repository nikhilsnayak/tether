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

const isContained = (
  point: CameraPoint,
  ground: GroundBounds,
  vertical: CameraVerticalBounds,
): boolean =>
  point.x >= ground.minX &&
  point.x <= ground.maxX &&
  point.y >= vertical.minY &&
  point.y <= vertical.maxY &&
  point.z >= ground.minZ &&
  point.z <= ground.maxZ;

/**
 * Places the camera at the requested clearance without crossing a room bound.
 * Blocked direction components are discarded so the camera slides along a
 * wall. A fully blocked direction falls back toward the room interior.
 */
export const resolveCameraClearance = (
  origin: CameraPoint,
  desired: CameraPoint,
  clearance: number,
  ground: GroundBounds,
  vertical: CameraVerticalBounds,
): CameraPoint => {
  let x = desired.x - origin.x;
  let y = desired.y - origin.y;
  let z = desired.z - origin.z;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const scale = clearance / Math.hypot(x, y, z);
    const candidate = {
      x: origin.x + x * scale,
      y: origin.y + y * scale,
      z: origin.z + z * scale,
    };
    if (isContained(candidate, ground, vertical)) return candidate;

    if (candidate.x < ground.minX || candidate.x > ground.maxX) x = 0;
    if (candidate.y < vertical.minY || candidate.y > vertical.maxY) y = 0;
    if (candidate.z < ground.minZ || candidate.z > ground.maxZ) z = 0;
    if (x === 0 && y === 0 && z === 0) break;
  }

  const inwardX =
    origin.x - ground.minX > ground.maxX - origin.x
      ? ground.minX - origin.x
      : ground.maxX - origin.x;
  const inwardZ =
    origin.z - ground.minZ > ground.maxZ - origin.z
      ? ground.minZ - origin.z
      : ground.maxZ - origin.z;
  return Math.abs(inwardX) > Math.abs(inwardZ)
    ? {
        x: origin.x + Math.sign(inwardX) * Math.min(clearance, Math.abs(inwardX)),
        y: origin.y,
        z: origin.z,
      }
    : {
        x: origin.x,
        y: origin.y,
        z: origin.z + Math.sign(inwardZ) * Math.min(clearance, Math.abs(inwardZ)),
      };
};

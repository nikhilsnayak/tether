import {
  AVATAR_WIRE_BOUNDS,
  type AvatarPose,
  type SequencedAvatarPose,
} from '@tether/client-runtime/modules/peer-session';

export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

export interface GroundBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface GroundObstacle {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface AvatarSpawn extends GroundPoint {
  readonly yaw: number;
}

export interface RoomGameplayConfig {
  readonly walkableBounds: GroundBounds;
  readonly obstacles: ReadonlyArray<GroundObstacle>;
  readonly spawns: {
    readonly host: AvatarSpawn;
    readonly guest: AvatarSpawn;
    readonly outsideGuest: AvatarSpawn;
  };
  readonly camera: {
    readonly distance: number;
    readonly minimumDistance: number;
    readonly maximumDistance: number;
    readonly height: number;
    readonly targetHeight: number;
    readonly followSeconds: number;
  };
}

export interface AvatarInputIntent {
  readonly forward: number;
  readonly turn: number;
}

export interface RemotePoseSample {
  readonly pose: SequencedAvatarPose;
  readonly receivedAtMs: number;
}

export const AVATAR_COLLISION_RADIUS = 0.32;
export const AVATAR_MOVE_SPEED = 2;
export const AVATAR_TURN_SPEED = Math.PI * 1.25;
export const AVATAR_SEND_INTERVAL_MS = 100;
export const REMOTE_INTERPOLATION_DELAY_MS = 100;
export const REMOTE_EXTRAPOLATION_LIMIT_MS = 250;
export const REMOTE_TELEPORT_DISTANCE = 2;
export const MAX_MOVEMENT_DELTA_SECONDS = 0.05;

export const EMPTY_AVATAR_INPUT: AvatarInputIntent = { forward: 0, turn: 0 };

export const canonicalYaw = (yaw: number): number => {
  const wrapped = ((((yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
};

export const shortestAngleDelta = (from: number, to: number): number => canonicalYaw(to - from);

export const avatarSpawn = (config: RoomGameplayConfig, intent: 'host' | 'join'): AvatarPose => {
  const spawn = intent === 'host' ? config.spawns.host : config.spawns.guest;
  return { ...spawn, action: 'idle' };
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const squaredDistance = (a: GroundPoint, b: GroundPoint) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

const resolveObstacle = (
  point: GroundPoint,
  previous: GroundPoint,
  obstacle: GroundObstacle,
): GroundPoint => {
  const minX = obstacle.minX - AVATAR_COLLISION_RADIUS;
  const maxX = obstacle.maxX + AVATAR_COLLISION_RADIUS;
  const minZ = obstacle.minZ - AVATAR_COLLISION_RADIUS;
  const maxZ = obstacle.maxZ + AVATAR_COLLISION_RADIUS;
  if (point.x < minX || point.x > maxX || point.z < minZ || point.z > maxZ) return point;

  const candidates = [
    { x: minX, z: point.z },
    { x: maxX, z: point.z },
    { x: point.x, z: minZ },
    { x: point.x, z: maxZ },
  ];
  return candidates.reduce(
    (nearest, candidate) =>
      squaredDistance(candidate, previous) < squaredDistance(nearest, previous)
        ? candidate
        : nearest,
    { x: minX, z: point.z },
  );
};

export const resolveAvatarPosition = (
  point: GroundPoint,
  previous: GroundPoint,
  config: RoomGameplayConfig,
): GroundPoint => {
  const bounded = {
    x: clamp(point.x, config.walkableBounds.minX, config.walkableBounds.maxX),
    z: clamp(point.z, config.walkableBounds.minZ, config.walkableBounds.maxZ),
  };
  return config.obstacles.reduce(
    (current, obstacle) => resolveObstacle(current, previous, obstacle),
    bounded,
  );
};

// Keep a moving avatar's center outside the other avatar's personal circle.
// Each client resolves only its local movement against the rendered remote pose,
// so the peers do not need shared collision authority.
export const resolveAvatarCollision = (
  point: GroundPoint,
  blocker: GroundPoint | null,
): GroundPoint => {
  if (blocker === null) return point;
  const minimum = AVATAR_COLLISION_RADIUS * 2;
  const dx = point.x - blocker.x;
  const dz = point.z - blocker.z;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared >= minimum * minimum) return point;
  if (distanceSquared === 0) return { x: blocker.x + minimum, z: blocker.z };
  const scale = minimum / Math.sqrt(distanceSquared);
  return { x: blocker.x + dx * scale, z: blocker.z + dz * scale };
};

export const integrateAvatarPose = (
  pose: AvatarPose,
  input: AvatarInputIntent,
  deltaSeconds: number,
  config: RoomGameplayConfig,
  blocker: GroundPoint | null = null,
): AvatarPose => {
  const delta = clamp(deltaSeconds, 0, MAX_MOVEMENT_DELTA_SECONDS);
  const turn = clamp(input.turn, -1, 1);
  const forward = clamp(input.forward, -1, 1);
  const yaw = canonicalYaw(pose.yaw + turn * AVATAR_TURN_SPEED * delta);
  const distance = forward * AVATAR_MOVE_SPEED * delta;
  const proposed = {
    x: pose.x + Math.sin(yaw) * distance,
    z: pose.z + Math.cos(yaw) * distance,
  };
  const bounded = resolveAvatarPosition(proposed, pose, config);
  // Treat the peer as a soft obstacle only while this avatar moves. Remote pose
  // interpolation therefore cannot push an idle local avatar around the room.
  const separated = distance === 0 ? bounded : resolveAvatarCollision(bounded, blocker);
  const position = resolveAvatarPosition(separated, bounded, config);
  return {
    ...position,
    yaw,
    action: Math.abs(distance) > 0 ? 'walk' : 'idle',
  };
};

export const shouldSendAvatarPose = ({
  nowMs,
  lastSentAtMs,
  lastSentPose,
  pose,
}: {
  readonly nowMs: number;
  readonly lastSentAtMs: number | null;
  readonly lastSentPose: AvatarPose | null;
  readonly pose: AvatarPose;
}): boolean => {
  if (lastSentAtMs === null || lastSentPose === null) return true;
  if (lastSentPose.action === 'walk' && pose.action === 'idle') return true;

  const poseChanged =
    pose.x !== lastSentPose.x ||
    pose.z !== lastSentPose.z ||
    pose.yaw !== lastSentPose.yaw ||
    pose.action !== lastSentPose.action;
  return poseChanged && nowMs - lastSentAtMs >= AVATAR_SEND_INTERVAL_MS;
};

export const appendRemotePoseSample = (
  samples: ReadonlyArray<RemotePoseSample>,
  sample: RemotePoseSample,
): ReadonlyArray<RemotePoseSample> => {
  const latest = samples.at(-1);
  if (latest !== undefined && sample.pose.sequence <= latest.pose.sequence) return samples;
  if (
    latest === undefined ||
    Math.sqrt(squaredDistance(latest.pose, sample.pose)) > REMOTE_TELEPORT_DISTANCE
  ) {
    return [sample];
  }
  return [latest, sample];
};

const interpolatePose = (
  from: SequencedAvatarPose,
  to: SequencedAvatarPose,
  alpha: number,
): AvatarPose => ({
  x: from.x + (to.x - from.x) * alpha,
  z: from.z + (to.z - from.z) * alpha,
  yaw: canonicalYaw(from.yaw + shortestAngleDelta(from.yaw, to.yaw) * alpha),
  action: to.action,
});

export const sampleRemoteAvatarPose = (
  samples: ReadonlyArray<RemotePoseSample>,
  nowMs: number,
  reducedMotion: boolean,
  config: RoomGameplayConfig,
): AvatarPose | null => {
  const latest = samples.at(-1);
  if (latest === undefined) return null;
  const previous = samples.at(-2);
  if (reducedMotion || previous === undefined) {
    const position = resolveAvatarPosition(latest.pose, latest.pose, config);
    return { ...latest.pose, ...position };
  }

  const targetMs = nowMs - REMOTE_INTERPOLATION_DELAY_MS;
  const sampleSpan = Math.max(1, latest.receivedAtMs - previous.receivedAtMs);
  if (targetMs <= latest.receivedAtMs) {
    const alpha = clamp((targetMs - previous.receivedAtMs) / sampleSpan, 0, 1);
    const interpolated = interpolatePose(previous.pose, latest.pose, alpha);
    const position = resolveAvatarPosition(interpolated, previous.pose, config);
    return { ...interpolated, ...position };
  }

  const extrapolationMs = Math.min(targetMs - latest.receivedAtMs, REMOTE_EXTRAPOLATION_LIMIT_MS);
  const extrapolated = interpolatePose(
    previous.pose,
    latest.pose,
    1 + extrapolationMs / sampleSpan,
  );
  const position = resolveAvatarPosition(extrapolated, latest.pose, config);
  return { ...extrapolated, ...position };
};

export const roomGameplayConfigIsWithinWireBounds = (config: RoomGameplayConfig): boolean =>
  config.walkableBounds.minX >= AVATAR_WIRE_BOUNDS.minX &&
  config.walkableBounds.maxX <= AVATAR_WIRE_BOUNDS.maxX &&
  config.walkableBounds.minZ >= AVATAR_WIRE_BOUNDS.minZ &&
  config.walkableBounds.maxZ <= AVATAR_WIRE_BOUNDS.maxZ;

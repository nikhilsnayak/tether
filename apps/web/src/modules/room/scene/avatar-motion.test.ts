import { describe, expect, it } from 'vitest';

import {
  appendRemotePoseSample,
  avatarSpawn,
  canonicalYaw,
  integrateAvatarPose,
  roomGameplayConfigIsWithinWireBounds,
  sampleRemoteAvatarPose,
  shouldSendAvatarPose,
  shortestAngleDelta,
  type RoomGameplayConfig,
} from './avatar-motion';

const config: RoomGameplayConfig = {
  walkableBounds: { minX: -4.35, maxX: 4.35, minZ: -3.35, maxZ: 4.35 },
  obstacles: [{ id: 'table', minX: -0.5, maxX: 0.5, minZ: 1, maxZ: 2 }],
  spawns: {
    host: { x: -1.25, z: 0.8, yaw: Math.PI / 2 },
    guest: { x: 1.25, z: 0.8, yaw: -Math.PI / 2 },
    outsideGuest: { x: 6.8, z: 1.65, yaw: -Math.PI / 2 },
  },
  camera: {
    distance: 5,
    minimumDistance: 3,
    maximumDistance: 7,
    height: 2.4,
    targetHeight: 1.1,
    followSeconds: 0.18,
  },
};

describe('avatar motion', () => {
  it('selects mirrored role-owned spawns', () => {
    expect(avatarSpawn(config, 'host')).toMatchObject({ x: -1.25, yaw: Math.PI / 2 });
    expect(avatarSpawn(config, 'join')).toMatchObject({ x: 1.25, yaw: -Math.PI / 2 });
  });

  it('caps large deltas, moves on the ground, and marks walking', () => {
    expect(
      integrateAvatarPose(avatarSpawn(config, 'host'), { forward: 1, turn: 0 }, 1, config),
    ).toMatchObject({ x: -1.15, z: 0.8, action: 'walk' });
    expect(
      integrateAvatarPose(avatarSpawn(config, 'host'), { forward: 0, turn: 0 }, 0.05, config),
    ).toMatchObject({ action: 'idle' });
  });

  it('clamps room edges and resolves obstacle corners', () => {
    const edge = integrateAvatarPose(
      { x: 4.34, z: 0, yaw: Math.PI / 2, action: 'walk' },
      { forward: 1, turn: 0 },
      0.05,
      config,
    );
    expect(edge.x).toBe(4.35);

    const blocked = integrateAvatarPose(
      { x: -0.83, z: 1.2, yaw: Math.PI / 2, action: 'idle' },
      { forward: 1, turn: 0 },
      0.05,
      config,
    );
    expect(blocked.x).toBeCloseTo(-0.82);
  });

  it('uses canonical shortest-angle turning across the wrap', () => {
    expect(canonicalYaw(Math.PI * 3)).toBe(Math.PI);
    expect(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });

  it('sends at 10 Hz plus an immediate final idle pose', () => {
    expect(
      shouldSendAvatarPose({ nowMs: 0, lastSentAtMs: null, previousAction: null, action: 'idle' }),
    ).toBe(true);
    expect(
      shouldSendAvatarPose({ nowMs: 99, lastSentAtMs: 0, previousAction: 'walk', action: 'walk' }),
    ).toBe(false);
    expect(
      shouldSendAvatarPose({ nowMs: 20, lastSentAtMs: 0, previousAction: 'walk', action: 'idle' }),
    ).toBe(true);
    expect(
      shouldSendAvatarPose({
        nowMs: 1_000,
        lastSentAtMs: 0,
        previousAction: 'idle',
        action: 'idle',
      }),
    ).toBe(false);
  });

  it('rejects out-of-order samples and resets on a teleport', () => {
    const first = {
      pose: { sequence: 2, x: 0, z: 0, yaw: 0, action: 'walk' } as const,
      receivedAtMs: 0,
    };
    expect(
      appendRemotePoseSample([first], { ...first, pose: { ...first.pose, sequence: 1 } }),
    ).toEqual([first]);
    const teleported = { pose: { ...first.pose, sequence: 3, x: 3 }, receivedAtMs: 100 };
    expect(appendRemotePoseSample([first], teleported)).toEqual([teleported]);
    const adjacent = { pose: { ...first.pose, sequence: 3, x: 1 }, receivedAtMs: 100 };
    expect(appendRemotePoseSample([first], adjacent)).toEqual([first, adjacent]);
  });

  it('interpolates, extrapolates briefly, then freezes', () => {
    const samples = [
      { pose: { sequence: 1, x: 0, z: 0, yaw: 3, action: 'walk' } as const, receivedAtMs: 0 },
      { pose: { sequence: 2, x: 1, z: 0, yaw: -3, action: 'walk' } as const, receivedAtMs: 100 },
    ];
    expect(sampleRemoteAvatarPose(samples, 150, false, config)?.x).toBeCloseTo(0.5);
    expect(sampleRemoteAvatarPose(samples, 300, false, config)?.x).toBeCloseTo(2);
    expect(sampleRemoteAvatarPose(samples, 1_000, false, config)?.x).toBeCloseTo(3.5);
    expect(sampleRemoteAvatarPose(samples, 150, true, config)?.x).toBe(1);
    expect(sampleRemoteAvatarPose([], 150, false, config)).toBeNull();
  });

  it('selects the nearest obstacle edge relative to the previous position', () => {
    const resolved = integrateAvatarPose(
      { x: 0, z: 2.4, yaw: Math.PI, action: 'walk' },
      { forward: 1, turn: 0 },
      0.05,
      config,
    );

    expect(resolved.z).toBeCloseTo(2.32);
  });

  it('requires every template walkable area to fit the shared wire envelope', () => {
    expect(roomGameplayConfigIsWithinWireBounds(config)).toBe(true);
    expect(
      roomGameplayConfigIsWithinWireBounds({
        ...config,
        walkableBounds: { ...config.walkableBounds, maxX: 5 },
      }),
    ).toBe(false);
  });
});

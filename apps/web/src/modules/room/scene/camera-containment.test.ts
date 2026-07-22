import { describe, expect, it } from 'vitest';

import { cameraContainmentScale, resolveCameraClearance } from './camera-containment';

const ground = { minX: -4.35, maxX: 4.35, minZ: -3.35, maxZ: 4.35 };
const vertical = { minY: 0.8, maxY: 4.2 };

describe('camera containment', () => {
  it('leaves an interior camera segment unchanged', () => {
    expect(
      cameraContainmentScale({ x: 0, y: 1.05, z: 0 }, { x: 2, y: 2.55, z: 3 }, ground, vertical),
    ).toBe(1);
  });

  it('shortens the whole orbit segment at a wall', () => {
    const origin = { x: 0, y: 1.05, z: 0 };
    const desired = { x: 6, y: 3.05, z: 3 };
    const scale = cameraContainmentScale(origin, desired, ground, vertical);

    expect(scale).toBeCloseTo(4.35 / 6);
    expect(origin.x + (desired.x - origin.x) * scale).toBeCloseTo(ground.maxX);
    expect(origin.z + (desired.z - origin.z) * scale).toBeCloseTo(2.175);
  });

  it('uses the first boundary hit by a diagonal segment', () => {
    const origin = { x: 1, y: 1.05, z: 1 };
    const desired = { x: -6, y: 5, z: -6 };
    const scale = cameraContainmentScale(origin, desired, ground, vertical);
    const resolved = {
      x: origin.x + (desired.x - origin.x) * scale,
      y: origin.y + (desired.y - origin.y) * scale,
      z: origin.z + (desired.z - origin.z) * scale,
    };

    expect(resolved.z).toBeCloseTo(ground.minZ);
    expect(resolved.x).toBeGreaterThanOrEqual(ground.minX);
    expect(resolved.y).toBeLessThanOrEqual(vertical.maxY);
  });

  it('collapses an outward segment when its target is already on the boundary', () => {
    expect(
      cameraContainmentScale(
        { x: ground.maxX, y: 1.05, z: 0 },
        { x: 6, y: 2.55, z: 0 },
        ground,
        vertical,
      ),
    ).toBe(0);
  });

  it('moves an outward clearance correction toward the room interior', () => {
    const origin = { x: ground.maxX, y: 1.05, z: 0 };
    const resolved = resolveCameraClearance(
      origin,
      { x: ground.maxX + 1, y: 1.05, z: 0 },
      1,
      ground,
      vertical,
    );

    expect(resolved).toEqual({ x: ground.maxX - 1, y: origin.y, z: origin.z });
  });

  it.each([
    ['minimum x', { x: ground.minX, y: 1.05, z: 0 }, { x: ground.minX - 1, y: 1.05, z: 0 }],
    ['maximum x', { x: ground.maxX, y: 1.05, z: 0 }, { x: ground.maxX + 1, y: 1.05, z: 0 }],
    ['minimum y', { x: 0, y: vertical.minY, z: 0 }, { x: 0, y: vertical.minY - 1, z: 0 }],
    ['maximum y', { x: 0, y: vertical.maxY, z: 0 }, { x: 0, y: vertical.maxY + 1, z: 0 }],
    ['minimum z', { x: 0, y: 1.05, z: ground.minZ }, { x: 0, y: 1.05, z: ground.minZ - 1 }],
    ['maximum z', { x: 0, y: 1.05, z: ground.maxZ }, { x: 0, y: 1.05, z: ground.maxZ + 1 }],
  ] as const)('preserves clearance at the %s boundary', (_, origin, desired) => {
    const resolved = resolveCameraClearance(origin, desired, 1, ground, vertical);

    expect(resolved.x).toBeGreaterThanOrEqual(ground.minX);
    expect(resolved.x).toBeLessThanOrEqual(ground.maxX);
    expect(resolved.y).toBeGreaterThanOrEqual(vertical.minY);
    expect(resolved.y).toBeLessThanOrEqual(vertical.maxY);
    expect(resolved.z).toBeGreaterThanOrEqual(ground.minZ);
    expect(resolved.z).toBeLessThanOrEqual(ground.maxZ);
    expect(
      Math.hypot(resolved.x - origin.x, resolved.y - origin.y, resolved.z - origin.z),
    ).toBeCloseTo(1);
  });

  it('slides a clearance correction along a blocking wall', () => {
    const origin = { x: ground.maxX, y: 1.05, z: 0 };
    const resolved = resolveCameraClearance(
      origin,
      { x: ground.maxX + 1, y: 1.05, z: 1 },
      1,
      ground,
      vertical,
    );

    expect(resolved).toEqual({ x: ground.maxX, y: origin.y, z: 1 });
  });
});

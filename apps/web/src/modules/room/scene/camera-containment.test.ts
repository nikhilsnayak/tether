import { describe, expect, it } from 'vitest';

import { cameraContainmentScale } from './camera-containment';

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
});

import { assert, describe, it } from 'vitest';

import {
  clampLook,
  isFiniteTransform,
  QUALITY_CONFIGS,
  resolveQualityTier,
  selectFraming,
  shouldAnimateCamera,
} from './config';

const look = {
  yaw: [-0.32, 0.32],
  pitch: [-0.16, 0.12],
  recenterAfterMs: 2_500,
  recenterSeconds: 1.2,
} as const;

describe('scene configuration', () => {
  it('bounds camera look and preserves values within the range', () => {
    assert.deepStrictEqual(clampLook(1, -1, look), { yaw: 0.32, pitch: -0.16 });
    assert.deepStrictEqual(clampLook(0.1, 0.05, look), { yaw: 0.1, pitch: 0.05 });
  });

  it('selects framing from viewport orientation', () => {
    const landscape = { position: [0, 1, 5], target: [0, 1, 0], fieldOfView: 42 } as const;
    const portrait = { position: [0, 1, 6], target: [0, 1, 0], fieldOfView: 52 } as const;
    assert.strictEqual(selectFraming(900, 600, landscape, portrait), landscape);
    assert.strictEqual(selectFraming(390, 844, landscape, portrait), portrait);
  });

  it('disables camera travel for reduced motion', () => {
    assert.isFalse(shouldAnimateCamera(true));
    assert.isTrue(shouldAnimateCamera(false));
  });

  it('defines progressively cheaper quality tiers', () => {
    assert.isAbove(QUALITY_CONFIGS.high.dpr[1], QUALITY_CONFIGS.medium.dpr[1]);
    assert.isAbove(QUALITY_CONFIGS.high.shadowMapSize, QUALITY_CONFIGS.medium.shadowMapSize);
    assert.isFalse(QUALITY_CONFIGS.low.shadows);
    assert.strictEqual(resolveQualityTier('auto', 2), 'medium');
    assert.strictEqual(resolveQualityTier('auto', 1), 'high');
    assert.strictEqual(resolveQualityTier('low', 2), 'low');
  });

  it('rejects non-finite transforms', () => {
    assert.isTrue(
      isFiniteTransform({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }),
    );
    assert.isFalse(
      isFiniteTransform({ position: [0, Number.NaN, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }),
    );
  });
});

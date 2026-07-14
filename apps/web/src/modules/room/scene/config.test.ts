import { assert, describe, it } from 'vitest';

import {
  clampLook,
  type AdaptiveQualityState,
  isQualityPreference,
  QUALITY_CONFIGS,
  ROOM_RENDERER_SETTINGS,
  initialAdaptiveQualityState,
  renderingQualitySettings,
  resolveQualityTier,
  sampleAdaptiveQuality,
  selectCameraFraming,
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
    const outside = { position: [8, 1, 0], target: [4, 1, 0], fieldOfView: 56 } as const;
    const framings = { landscape, portrait, outside };

    assert.strictEqual(selectCameraFraming(900, 600, false, framings), landscape);
    assert.strictEqual(selectCameraFraming(390, 844, false, framings), portrait);
    assert.strictEqual(selectCameraFraming(900, 600, true, framings), outside);
    assert.strictEqual(selectCameraFraming(390, 844, true, framings), outside);
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

  it.each(['high', 'medium', 'low'] as const)(
    'translates %s quality into live Canvas settings',
    (tier) => {
      const quality = QUALITY_CONFIGS[tier];

      assert.deepStrictEqual(renderingQualitySettings(quality), {
        canvas: { dpr: [...quality.dpr], shadows: quality.shadows },
      });
    },
  );

  it('keeps renderer-construction settings fixed across live quality changes', () => {
    assert.deepStrictEqual(ROOM_RENDERER_SETTINGS, {
      antialias: true,
      forceWebGL: false,
      powerPreference: 'high-performance',
    });
  });

  it('degrades only after sustained slow samples and then observes a cooldown', () => {
    let state = initialAdaptiveQualityState(1);
    state = sampleAdaptiveQuality(state, 40);
    state = sampleAdaptiveQuality(state, 40);
    assert.strictEqual(state.tier, 'high');
    state = sampleAdaptiveQuality(state, 40);
    assert.strictEqual(state.tier, 'medium');

    for (let index = 0; index < 8; index += 1) state = sampleAdaptiveQuality(state, 60);
    assert.strictEqual(state.tier, 'medium');
  });

  it('requires a much longer healthy run before restoring quality', () => {
    let state: AdaptiveQualityState = { ...initialAdaptiveQualityState(2), tier: 'medium' };
    for (let index = 0; index < 11; index += 1) state = sampleAdaptiveQuality(state, 60);
    assert.strictEqual(state.tier, 'medium');
    state = sampleAdaptiveQuality(state, 60);
    assert.strictEqual(state.tier, 'high');
  });

  it('moves between every adaptive quality tier', () => {
    const medium = sampleAdaptiveQuality(
      { tier: 'medium', slowSamples: 2, fastSamples: 0, cooldownSamples: 0 },
      20,
    );
    assert.strictEqual(medium.tier, 'low');

    const low = sampleAdaptiveQuality(
      { tier: 'low', slowSamples: 0, fastSamples: 11, cooldownSamples: 0 },
      60,
    );
    assert.strictEqual(low.tier, 'medium');
  });

  it('recognizes only supported persisted quality values', () => {
    for (const preference of ['auto', 'high', 'medium', 'low']) {
      assert.isTrue(isQualityPreference(preference));
    }
    assert.isFalse(isQualityPreference('ultra'));
    assert.isFalse(isQualityPreference(null));
  });
});

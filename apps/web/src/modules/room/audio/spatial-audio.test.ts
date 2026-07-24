import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_FALLOFF,
  distance2d,
  isSpatialAudioSupported,
  listenerForwardFromYaw,
  spatialGain,
} from './spatial-audio';

describe('spatial audio foundations', () => {
  describe('isSpatialAudioSupported', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('is false when AudioContext is undefined', () => {
      vi.stubGlobal('AudioContext', undefined);
      expect(isSpatialAudioSupported()).toBe(false);
    });

    it('is false when setSinkId is not a function', () => {
      vi.stubGlobal('AudioContext', function AudioContextMock() {});
      expect(isSpatialAudioSupported()).toBe(false);
    });

    it('is true when setSinkId is a function', () => {
      function AudioContextMock() {}
      AudioContextMock.prototype.setSinkId = () => {};
      vi.stubGlobal('AudioContext', AudioContextMock);
      expect(isSpatialAudioSupported()).toBe(true);
    });
  });

  describe('listenerForwardFromYaw', () => {
    it('points down +Z at yaw 0', () => {
      const { forwardX, forwardZ } = listenerForwardFromYaw(0);
      expect(forwardX).toBeCloseTo(0);
      expect(forwardZ).toBeCloseTo(1);
    });

    it('points down +X at yaw PI/2', () => {
      const { forwardX, forwardZ } = listenerForwardFromYaw(Math.PI / 2);
      expect(forwardX).toBeCloseTo(1);
      expect(forwardZ).toBeCloseTo(0);
    });
  });

  describe('distance2d', () => {
    it('is the euclidean distance on the ground plane', () => {
      expect(distance2d({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
    });
  });

  describe('spatialGain', () => {
    it('is full volume at or within refDistance', () => {
      expect(spatialGain(0, DEFAULT_FALLOFF)).toBe(1);
      expect(spatialGain(1.5, DEFAULT_FALLOFF)).toBe(1);
    });

    it('is the floor at or beyond maxDistance', () => {
      expect(spatialGain(11, DEFAULT_FALLOFF)).toBe(DEFAULT_FALLOFF.floor);
      expect(spatialGain(20, DEFAULT_FALLOFF)).toBe(DEFAULT_FALLOFF.floor);
    });

    it('interpolates linearly between refDistance and maxDistance', () => {
      // midpoint of 1.5 and 11: 1 - 0.5 * (1 - 0.25) = 0.625
      expect(spatialGain(6.25, DEFAULT_FALLOFF)).toBeCloseTo(0.625);
    });
  });
});

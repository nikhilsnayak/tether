import { describe, expect, it } from 'vitest';

import { nearestTileCorner, pinnedTileOffset } from './use-pinned-draggable-tile';

describe('pinned draggable tiles', () => {
  it('places stable initial corners independently', () => {
    const boundary = { width: 1_280, height: 600 };
    const tile = { width: 192, height: 108 };
    expect(pinnedTileOffset(boundary, tile, 16, 'tl')).toEqual({ x: 16, y: 16 });
    expect(pinnedTileOffset(boundary, tile, 16, 'tr')).toEqual({ x: 1_072, y: 16 });
  });

  it('recomputes offsets within a portrait boundary above reserved controls', () => {
    expect(
      pinnedTileOffset({ width: 358, height: 684 }, { width: 112, height: 140 }, 16, 'br'),
    ).toEqual({ x: 230, y: 528 });
  });

  it.each([
    [100, 100, 'tl'],
    [900, 100, 'tr'],
    [100, 600, 'bl'],
    [900, 600, 'br'],
  ] as const)('snaps (%s, %s) to %s', (x, y, corner) => {
    expect(nearestTileCorner({ width: 1_000, height: 700 }, { x, y })).toBe(corner);
  });
});

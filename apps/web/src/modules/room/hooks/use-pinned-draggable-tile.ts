import type { MotionValue } from 'motion/react';
import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react';

export type TileCorner = 'tl' | 'tr' | 'bl' | 'br';

export const pinnedTileOffset = (
  boundary: { readonly width: number; readonly height: number },
  tile: { readonly width: number; readonly height: number },
  margin: number,
  corner: TileCorner,
) => ({
  x: corner === 'tl' || corner === 'bl' ? margin : boundary.width - tile.width - margin,
  y: corner === 'tl' || corner === 'tr' ? margin : boundary.height - tile.height - margin,
});

export const nearestTileCorner = (
  stage: { readonly width: number; readonly height: number },
  tileCenter: { readonly x: number; readonly y: number },
): TileCorner =>
  `${tileCenter.y < stage.height / 2 ? 't' : 'b'}${
    tileCenter.x < stage.width / 2 ? 'l' : 'r'
  }` as TileCorner;

export function usePinnedDraggableTile(
  tileRef: RefObject<HTMLDivElement | null>,
  x: MotionValue<number>,
  y: MotionValue<number>,
  margin: number,
  initialCorner: TileCorner,
) {
  const cornerRef = useRef<TileCorner>(initialCorner);

  const cornerOffset = (corner: TileCorner) => {
    const tile = tileRef.current;
    const boundary = tile?.offsetParent as HTMLElement | null;
    if (tile === null || boundary === null) {
      return { x: 0, y: 0 };
    }

    return pinnedTileOffset(
      { width: boundary.clientWidth, height: boundary.clientHeight },
      { width: tile.offsetWidth, height: tile.offsetHeight },
      margin,
      corner,
    );
  };

  const pinToCurrentCorner = useEffectEvent(() => {
    const offset = cornerOffset(cornerRef.current);
    x.set(offset.x);
    y.set(offset.y);
  });

  useLayoutEffect(() => {
    pinToCurrentCorner();
    const tile = tileRef.current;
    const boundary = tile?.offsetParent;
    const resizeObserver = new ResizeObserver(pinToCurrentCorner);
    if (tile !== null) resizeObserver.observe(tile);
    if (boundary !== null && boundary !== undefined) resizeObserver.observe(boundary);
    window.addEventListener('resize', pinToCurrentCorner);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', pinToCurrentCorner);
    };
  }, [tileRef]);

  return { cornerRef, cornerOffset };
}

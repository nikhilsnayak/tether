import type { MotionValue } from 'motion/react';
import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react';

export type TileCorner = 'tl' | 'tr' | 'bl' | 'br';

export function usePinnedDraggableTile(
  tileRef: RefObject<HTMLDivElement | null>,
  x: MotionValue<number>,
  y: MotionValue<number>,
  margin: number,
) {
  const cornerRef = useRef<TileCorner>('br');

  const cornerOffset = (corner: TileCorner) => {
    const tile = tileRef.current;
    const boundary = tile?.offsetParent as HTMLElement | null;
    if (tile === null || boundary === null) {
      return { x: 0, y: 0 };
    }

    const maxX = boundary.clientWidth - tile.offsetWidth - margin;
    const maxY = boundary.clientHeight - tile.offsetHeight - margin;
    return {
      x: corner === 'tl' || corner === 'bl' ? margin : maxX,
      y: corner === 'tl' || corner === 'tr' ? margin : maxY,
    };
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

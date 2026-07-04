import { useEffect } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const TILE_SNAP = { stiffness: 500, damping: 40 };

export function usePinnedDraggableTile({
  stage,
  tileWidth,
  tileHeight,
  maxX,
  maxY,
  margin,
}: {
  readonly stage: { readonly width: number; readonly height: number };
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly margin: number;
}) {
  // Off-screen until the stage is measured, so the first pin lands bottom-right.
  const x = useSharedValue(10_000);
  const y = useSharedValue(10_000);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (stage.width === 0 || stage.height === 0) {
      return;
    }
    x.value = x.value * 2 + tileWidth < stage.width ? margin : maxX;
    y.value = y.value * 2 + tileHeight < stage.height ? margin : maxY;
  }, [stage.width, stage.height, tileWidth, tileHeight, margin, maxX, maxY, x, y]);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
      scale.value = withSpring(1.04, TILE_SNAP);
    })
    .onUpdate((event) => {
      x.value = Math.min(Math.max(startX.value + event.translationX, margin), maxX);
      y.value = Math.min(Math.max(startY.value + event.translationY, margin), maxY);
    })
    .onEnd(() => {
      x.value = withSpring(x.value * 2 + tileWidth < stage.width ? margin : maxX, TILE_SNAP);
      y.value = withSpring(y.value * 2 + tileHeight < stage.height ? margin : maxY, TILE_SNAP);
    })
    .onFinalize(() => {
      scale.value = withSpring(1, TILE_SNAP);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return { pan, animatedStyle };
}

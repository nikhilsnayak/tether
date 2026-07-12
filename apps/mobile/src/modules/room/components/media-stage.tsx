import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { RTCView, type MediaStream } from 'react-native-webrtc';

import { colors, mono } from '@/lib/theme';

import { usePinnedDraggableTile } from '../hooks/use-pinned-draggable-tile';

export function RemoteVideo({ stream }: { readonly stream: MediaStream }) {
  return <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit='cover' />;
}

export function SelfPreview({
  stream,
  cameraOn,
  stage,
}: {
  readonly stream: MediaStream | null;
  readonly cameraOn: boolean;
  readonly stage: { readonly width: number; readonly height: number };
}) {
  const { width, height } = useWindowDimensions();
  const aspectRatio = height > 0 ? width / height : 1;
  const tileWidth = Math.min(Math.max(width * 0.3, 112), aspectRatio > 1 ? 224 : 144);
  const tileHeight = tileWidth / aspectRatio;
  const margin = 12;
  const maxX = Math.max(stage.width - tileWidth - margin, margin);
  const maxY = Math.max(stage.height - tileHeight - margin, margin);
  const { pan, animatedStyle } = usePinnedDraggableTile({
    stage,
    tileWidth,
    tileHeight,
    maxX,
    maxY,
    margin,
  });
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.tile, { width: tileWidth, aspectRatio }, animatedStyle]}>
        {stream !== null && cameraOn ? (
          <RTCView
            streamURL={stream.toURL()}
            style={styles.video}
            objectFit='cover'
            mirror
            zOrder={1}
          />
        ) : (
          <View style={styles.off}>
            <Text style={styles.pill}>cam off</Text>
          </View>
        )}
        <View style={styles.captionChip}>
          <Text style={styles.caption}>You</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  tile: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  video: { flex: 1 },
  off: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pill: { ...mono, color: colors.foreground, fontSize: 11 },
  captionChip: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    backgroundColor: `${colors.background}80`,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  caption: { ...mono, color: colors.foreground, fontSize: 9 },
});

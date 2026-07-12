import { useAtomValue } from '@effect/atom-react';
import { peerSessionViewAtom } from '@tether/client-runtime/modules/room';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, Share2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { colors, mono } from '@/lib/theme';

const webBaseUrl = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://tether.nikhilsnayak.dev';

export function RoomInvite() {
  const roomId = useAtomValue(peerSessionViewAtom).roomId;
  const [closed, setClosed] = useState(false);
  const [copied, setCopied] = useState(false);
  if (roomId === null || closed) return null;
  const roomUrl = `${webBaseUrl}/room/${encodeURIComponent(roomId)}`;
  const copyRoomUrl = async () => {
    try {
      await Clipboard.setStringAsync(roomUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
      Alert.alert('Copy failed', 'Could not copy the room link. Please try again.');
    }
  };
  const shareRoomUrl = () => {
    void Share.share({ message: `Join my Tether video call\n${roomUrl}` }).catch((error) => {
      const cancelled =
        error === 'ABORT_ERROR' ||
        (error instanceof Error && error.name === 'AbortError') ||
        error?.code === 'ERR_CANCELLED';
      if (!cancelled)
        Alert.alert('Share failed', 'Could not share the room link. Please try again.');
    });
  };
  return (
    <View accessibilityLabel='Room invite' style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Room ready</Text>
        <Pressable accessibilityLabel='Close' onPress={() => setClosed(true)} hitSlop={8}>
          <X color={colors.mutedForeground} size={16} />
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text style={styles.text}>
          Send this link to the one person you want to call. They enter a name and knock; you let
          them in.
        </Text>
        <Text selectable style={styles.url}>
          {roomUrl}
        </Text>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Copy room link'
          onPress={() => void copyRoomUrl()}
          style={({ pressed }) => [styles.copy, pressed && styles.pressed]}
        >
          {copied ? (
            <Check color={colors.success} size={16} />
          ) : (
            <Copy color={colors.foreground} size={16} />
          )}
          <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy link'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          onPress={shareRoomUrl}
          style={({ pressed }) => [styles.share, pressed && styles.pressed]}
        >
          <Share2 color={colors.background} size={16} />
          <Text style={styles.shareText}>Share room</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 108,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 6,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerText: { ...mono, color: colors.mutedForeground, fontSize: 11 },
  body: { gap: 12, padding: 16 },
  text: { color: colors.foreground, fontSize: 13, lineHeight: 20 },
  url: { fontFamily: 'monospace', color: colors.mutedForeground, fontSize: 12 },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 12,
  },
  copyText: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  share: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingVertical: 12,
  },
  shareText: { color: colors.background, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});

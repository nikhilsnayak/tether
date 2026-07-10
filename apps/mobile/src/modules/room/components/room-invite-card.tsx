import * as Clipboard from 'expo-clipboard';
import { Check, Copy, Share2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { colors, mono } from '@/lib/theme';

const webBaseUrl = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://tether.nikhilsnayak.dev';

export function RoomInviteCard({
  roomId,
  onClose,
}: {
  readonly roomId: string;
  readonly onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Share the web URL so the invitee needs nothing installed.
  const roomUrl = `${webBaseUrl}/room/${encodeURIComponent(roomId)}`;

  const copyRoomUrl = async () => {
    try {
      await Clipboard.setStringAsync(roomUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch (error) {
      setCopied(false);
      Alert.alert('Copy failed', 'Could not copy the room link. Please try again.');
    }
  };

  const shareRoomUrl = () => {
    void Share.share({ message: `Join my Tether video call\n${roomUrl}` }).catch((error) => {
      // Share.share throws 'ABORT_ERROR' or Error with name 'AbortError' when cancelled by the user.
      // These are not failures, so we only alert on genuine errors.
      const isCancellation =
        error === 'ABORT_ERROR' ||
        (error instanceof Error && error.name === 'AbortError') ||
        error?.code === 'ERR_CANCELLED';
      if (!isCancellation) {
        Alert.alert('Share failed', 'Could not share the room link. Please try again.');
      }
    });
  };

  return (
    <View accessibilityLabel='Room invite' style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardHeaderText}>Room ready</Text>
        <Pressable accessibilityLabel='Close' onPress={onClose} hitSlop={8}>
          <X color={colors.mutedForeground} size={16} />
        </Pressable>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardText}>
          Send this link to the one person you want to call. They enter a name and knock; you let
          them in.
        </Text>
        <Text selectable style={styles.roomUrl}>
          {roomUrl}
        </Text>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Copy room link'
          onPress={() => void copyRoomUrl()}
          style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
        >
          {copied ? (
            <Check color={colors.success} size={16} />
          ) : (
            <Copy color={colors.foreground} size={16} />
          )}
          <Text style={styles.copyButtonText}>{copied ? 'Copied' : 'Copy link'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          onPress={shareRoomUrl}
          style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
        >
          <Share2 color={colors.background} size={16} />
          <Text style={styles.shareButtonText}>Share room</Text>
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cardHeaderText: { ...mono, color: colors.mutedForeground, fontSize: 11 },
  cardBody: { gap: 12, padding: 16 },
  cardText: { color: colors.foreground, fontSize: 13, lineHeight: 20 },
  roomUrl: { fontFamily: 'monospace', color: colors.mutedForeground, fontSize: 12 },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 12,
  },
  copyButtonText: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingVertical: 12,
  },
  shareButtonText: { color: colors.background, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});

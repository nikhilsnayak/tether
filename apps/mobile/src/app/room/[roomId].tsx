import { PeerId, RoomId } from '@tether/contracts/modules/room';
import { Stack, useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Share2, X } from 'lucide-react-native';
import { Suspense, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { colors, mono } from '@/lib/theme';
import { generatePeerId } from '@/lib/utils';
import { CallErrorScreen, CallLoadingScreen, CallScreen } from '@/modules/room/components/room';

const webBaseUrl = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://tether.nikhilsnayak.dev';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CallErrorScreen error={error} retry={() => void retry()} />;
}

export default function RoomPage() {
  const { roomId, invite } = useLocalSearchParams<{ roomId: string; invite?: string }>();
  const router = useRouter();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  const [inviteOpen, setInviteOpen] = useState(invite === 'true');

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen
          session={{ roomId: RoomId.make(roomId), selfId }}
          onLeaveRoom={() => router.dismissTo('/')}
        />
      </Suspense>
      {inviteOpen && <RoomInviteCard roomId={roomId} onClose={() => setInviteOpen(false)} />}
    </>
  );
}

function RoomInviteCard({
  roomId,
  onClose,
}: {
  readonly roomId: string;
  readonly onClose: () => void;
}) {
  // Share the web URL so the invitee needs nothing installed.
  const roomUrl = `${webBaseUrl}/room/${encodeURIComponent(roomId)}`;

  const shareRoomUrl = () => {
    void Share.share({ message: `Join my Tether video call\n${roomUrl}` }).catch(() => {});
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
          Send this link to the one person you want to call. First to open it joins the line.
        </Text>
        <Text selectable style={styles.roomUrl}>
          {roomUrl}
        </Text>
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

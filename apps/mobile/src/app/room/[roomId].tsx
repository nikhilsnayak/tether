import type { RoomSession } from '@tether/client-runtime/modules/room';
import { DisplayName, PeerId, RoomId } from '@tether/contracts/modules/room';
import { Stack, useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Suspense, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/logo';
import { colors, mono } from '@/lib/theme';
import { generatePeerId } from '@/lib/utils';
import { CallErrorScreen, CallLoadingScreen, CallScreen } from '@/modules/room/components/room';

const MAX_DISPLAY_NAME = 32;

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CallErrorScreen error={error} retry={() => void retry()} />;
}

export default function RoomPage() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  const [displayName, setDisplayName] = useState<DisplayName | null>(null);

  if (displayName === null) {
    return <JoinNameScreen onSubmit={setDisplayName} />;
  }

  const session: RoomSession = {
    intent: 'join',
    roomId: RoomId.make(roomId),
    selfId,
    displayName,
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen session={session} onLeaveRoom={() => router.dismissTo('/')} />
      </Suspense>
    </>
  );
}

// Collected before media/session start: the joiner presents a name, the host
// approves or denies. Never persisted.
function JoinNameScreen({ onSubmit }: { readonly onSubmit: (name: DisplayName) => void }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const canContinue = trimmed.length > 0;

  const handleSubmit = () => {
    if (canContinue) {
      onSubmit(DisplayName.make(trimmed));
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Wordmark size={28} />
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelLabel}>Join call</Text>
        <Text style={styles.title}>What should the host call you?</Text>
        <Text style={styles.body}>
          The host sees this name before letting you in. It is not saved anywhere.
        </Text>
        <TextInput
          accessibilityLabel='Your name'
          autoCapitalize='none'
          autoCorrect={false}
          maxLength={MAX_DISPLAY_NAME}
          onChangeText={setName}
          onSubmitEditing={handleSubmit}
          placeholder='Your name'
          placeholderTextColor={colors.mutedForeground}
          returnKeyType='go'
          style={styles.input}
          value={name}
        />
        <Pressable
          accessibilityRole='button'
          disabled={!canContinue}
          onPress={handleSubmit}
          style={({ pressed }) => [
            styles.primaryButton,
            !canContinue && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>Knock to join</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: 20, gap: 20 },
  header: { gap: 8, paddingVertical: 24 },
  panel: {
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 6,
    padding: 16,
  },
  panelLabel: { ...mono, color: colors.mutedForeground, fontSize: 11 },
  title: { color: colors.foreground, fontSize: 22, fontWeight: '600' },
  body: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  input: {
    ...mono,
    color: colors.foreground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingVertical: 12,
  },
  primaryButtonText: { color: colors.background, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});

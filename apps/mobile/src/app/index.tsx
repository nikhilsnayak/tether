import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/logo';
import { colors, mono } from '@/lib/theme';
import { formatRoomCodeInput, generateRoomId, ROOM_CODE_LENGTH } from '@/lib/utils';

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const canJoin = code.length === ROOM_CODE_LENGTH;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Wordmark size={28} />
        <Text style={styles.tagline}>A private line between two people</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelLabel}>01 — New call</Text>
        <Pressable
          accessibilityRole='button'
          onPress={() => router.push(`/room/${generateRoomId()}`)}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryButtonText}>Start a call</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelLabel}>02 — Join a call</Text>
        <TextInput
          accessibilityLabel='Room code'
          autoCapitalize='none'
          autoCorrect={false}
          onChangeText={(raw) => setCode(formatRoomCodeInput(raw))}
          placeholder='xxx-xxxx-xxx'
          placeholderTextColor={colors.mutedForeground}
          style={styles.input}
          value={code}
        />
        <Pressable
          accessibilityRole='button'
          disabled={!canJoin}
          onPress={() => router.push(`/room/${code}`)}
          style={({ pressed }) => [
            styles.secondaryButton,
            !canJoin && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>Join</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: 20, gap: 20 },
  header: { gap: 8, paddingVertical: 24 },
  tagline: { color: colors.mutedForeground, fontSize: 14 },
  panel: {
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 6,
    padding: 16,
  },
  panelLabel: { ...mono, color: colors.mutedForeground, fontSize: 11 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingVertical: 12,
  },
  primaryButtonText: { color: colors.background, fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 12,
  },
  secondaryButtonText: { color: colors.foreground, fontSize: 15, fontWeight: '500' },
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
    textTransform: 'lowercase',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});

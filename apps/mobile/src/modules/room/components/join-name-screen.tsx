import { DisplayName } from '@tether/contracts/modules/room';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/logo';
import { colors, mono } from '@/lib/theme';

const MAX_DISPLAY_NAME = 32;

export function JoinNameScreen({ onSubmit }: { readonly onSubmit: (name: DisplayName) => void }) {
  const [name, setName] = useState('');
  const canContinue = name.trim().length > 0;
  const handleSubmit = () => {
    if (canContinue) onSubmit(DisplayName.make(name.trim()));
  };
  return (
    <SafeAreaView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Wordmark size={28} />
      </View>
      <View style={styles.panel}>
        <Text style={styles.label}>Join call</Text>
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
            styles.primary,
            !canContinue && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryText}>Knock to join</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { padding: 16 },
  panel: { flex: 1, justifyContent: 'center', gap: 12, padding: 24 },
  label: { ...mono, color: colors.mutedForeground, fontSize: 11 },
  title: { color: colors.foreground, fontSize: 26, letterSpacing: -0.5 },
  body: { color: colors.mutedForeground, fontSize: 14, lineHeight: 21 },
  input: {
    color: colors.foreground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: 10,
    fontSize: 18,
  },
  primary: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingVertical: 13,
  },
  primaryText: { color: colors.background, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});

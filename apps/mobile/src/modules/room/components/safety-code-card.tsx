import { ShieldCheck } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { colors, mono } from '@/lib/theme';

import { ActionButton } from './action-button';

export function SafetyCodeCard({
  code,
  onMismatch,
  onConfirm,
}: {
  readonly code: string;
  readonly onMismatch: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <View accessibilityLabel='Safety check' style={styles.card}>
      <View style={styles.titleRow}>
        <ShieldCheck color={colors.foreground} size={16} />
        <Text style={styles.title}>Safety check</Text>
      </View>
      <Text accessibilityLabel='Safety code' style={styles.code}>
        {code}
      </Text>
      <Text style={styles.hint}>
        Compare this code over a trusted channel, such as reading it aloud. A match checks that the
        server did not substitute either connection fingerprint. Continue only if you both see the
        same code.
      </Text>
      <View style={styles.actions}>
        <View style={styles.grow}>
          <ActionButton label="They don't match" variant='danger' onPress={onMismatch} />
        </View>
        <View style={styles.grow}>
          <ActionButton label='We see the same code' variant='primary' onPress={onConfirm} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: `${colors.background}f2`,
    borderRadius: 6,
    padding: 16,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...mono, color: colors.foreground, fontSize: 11 },
  code: { ...mono, color: colors.foreground, fontSize: 17, textAlign: 'center', letterSpacing: 3 },
  hint: { color: colors.mutedForeground, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
});

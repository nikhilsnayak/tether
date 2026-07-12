import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/logo';
import { colors, mono } from '@/lib/theme';

import { ActionButton } from './action-button';

export function CallStatusScreen({
  indicatorColor,
  pillLabel,
  label,
  hint,
  action,
}: {
  readonly indicatorColor: string;
  readonly pillLabel: string;
  readonly label: string;
  readonly hint: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Wordmark size={20} />
        <View style={styles.pill}>
          <View style={[styles.dot, { backgroundColor: indicatorColor }]} />
          <Text style={styles.pillText}>{pillLabel}</Text>
        </View>
      </View>
      <View style={styles.body}>
        <View style={styles.frame}>
          <View style={[styles.frameDot, { backgroundColor: indicatorColor }]} />
        </View>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
        {action !== undefined && <View style={styles.action}>{action}</View>}
      </View>
    </SafeAreaView>
  );
}

export function CallLoadingScreen() {
  return (
    <CallStatusScreen
      indicatorColor={colors.warning}
      pillLabel='Starting'
      label='Starting your call…'
      hint='Setting up your connection.'
    />
  );
}

export function CallErrorScreen({
  error,
  retry,
}: {
  readonly error: unknown;
  readonly retry: () => void;
}) {
  const message = error instanceof Error ? error.message : 'Unknown peer-session failure';
  return (
    <CallStatusScreen
      indicatorColor={colors.destructive}
      pillLabel='Failed'
      label='Something went wrong'
      hint={message}
      action={<ActionButton label='Try again' onPress={retry} />}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: `${colors.background}b3`,
    borderRadius: 6,
    padding: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { ...mono, color: colors.foreground, fontSize: 11 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  frame: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 8,
  },
  frameDot: { width: 10, height: 10, borderRadius: 5 },
  label: { ...mono, color: colors.foreground, fontSize: 13, textAlign: 'center' },
  hint: { color: colors.mutedForeground, fontSize: 13, textAlign: 'center' },
  action: { marginTop: 12 },
});

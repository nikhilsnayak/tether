import type { WatchControlCommand } from '@tether/client-runtime/modules/watch-along';
import { Pause, Play, RotateCcw, Square } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, mono } from '@/lib/theme';

import type { MobileWatchPresentation } from './presentation';

export function WatchControls({
  presentation,
  requestControl,
}: {
  readonly presentation: MobileWatchPresentation;
  readonly requestControl: (control: WatchControlCommand) => void;
}) {
  if (!presentation.active) return null;

  const mainControl = presentation.control;
  const MainIcon = mainControl === 'play' ? Play : mainControl === 'pause' ? Pause : RotateCcw;
  const mainLabel = mainControl === 'play' ? 'Play' : mainControl === 'pause' ? 'Pause' : 'Replay';

  return (
    <View accessibilityLabel='Watch Together controls' style={styles.panel}>
      <View style={styles.copy}>
        <Text style={styles.label}>{presentation.label}</Text>
        <Text numberOfLines={1} style={styles.hint}>
          {presentation.hint}
        </Text>
      </View>
      <View style={styles.actions}>
        {mainControl !== null && (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={`${mainLabel} shared video`}
            onPress={() => requestControl({ kind: mainControl })}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <MainIcon color={colors.foreground} size={18} />
            <Text style={styles.buttonLabel}>{mainLabel}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Stop shared video'
          onPress={() => requestControl({ kind: 'eject' })}
          style={({ pressed }) => [styles.button, styles.stopButton, pressed && styles.pressed]}
        >
          <Square color={colors.mutedForeground} size={16} />
          <Text style={styles.buttonLabel}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  copy: { flex: 1, gap: 3 },
  label: { ...mono, color: colors.foreground, fontSize: 10 },
  hint: { color: colors.mutedForeground, fontSize: 11 },
  actions: { flexDirection: 'row', gap: 8 },
  button: {
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 4,
    backgroundColor: colors.secondary,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  stopButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  buttonLabel: { ...mono, color: colors.foreground, fontSize: 8 },
  pressed: { opacity: 0.7 },
});

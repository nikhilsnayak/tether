import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/lib/theme';

export function ActionButton({
  label,
  variant = 'secondary',
  onPress,
}: {
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'danger';
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole='button'
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primary,
        variant === 'danger' && styles.danger,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.text,
          variant === 'primary' && styles.primaryText,
          variant === 'danger' && styles.dangerText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primary: { backgroundColor: colors.brand, borderColor: colors.brand },
  danger: { backgroundColor: colors.destructiveMuted, borderColor: 'transparent' },
  text: { color: colors.foreground, fontSize: 13, fontWeight: '500' },
  primaryText: { color: colors.background, fontWeight: '600' },
  dangerText: { color: colors.destructive },
  pressed: { opacity: 0.7 },
});

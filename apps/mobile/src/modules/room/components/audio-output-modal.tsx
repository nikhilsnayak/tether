import { Bluetooth, Check, Headphones, Smartphone, Volume2, VolumeX, X } from 'lucide-react-native';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, mono } from '@/lib/theme';

import { AUDIO_ROUTE_LABEL, type AudioRoute } from '../audio-output';

function AudioRouteIcon({ route }: { readonly route: AudioRoute }) {
  switch (route) {
    case 'SPEAKER_PHONE':
      return <Volume2 color={colors.foreground} size={18} />;
    case 'EARPIECE':
      return <Smartphone color={colors.foreground} size={18} />;
    case 'WIRED_HEADSET':
      return <Headphones color={colors.foreground} size={18} />;
    case 'BLUETOOTH':
      return <Bluetooth color={colors.foreground} size={18} />;
  }
}

export function AudioOutputModal({
  open,
  availableRoutes,
  selectedRoute,
  remoteAudioOn,
  onClose,
  onSelectRoute,
  onTurnOff,
}: {
  readonly open: boolean;
  readonly availableRoutes: readonly AudioRoute[];
  readonly selectedRoute: AudioRoute;
  readonly remoteAudioOn: boolean;
  readonly onClose: () => void;
  readonly onSelectRoute: (route: AudioRoute) => void;
  readonly onTurnOff: () => void;
}) {
  return (
    <Modal
      visible={open}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType='fade'
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel='Close audio output' onPress={onClose} style={styles.scrim} />
        <View accessibilityRole='radiogroup' style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Audio output</Text>
            <Pressable accessibilityLabel='Close audio output' onPress={onClose} hitSlop={8}>
              <X color={colors.mutedForeground} size={18} />
            </Pressable>
          </View>
          {availableRoutes.map((route) => {
            const selected = remoteAudioOn && route === selectedRoute;
            return (
              <Pressable
                key={route}
                accessibilityRole='radio'
                accessibilityState={{ checked: selected }}
                onPress={() => onSelectRoute(route)}
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              >
                <AudioRouteIcon route={route} />
                <Text style={styles.optionText}>{AUDIO_ROUTE_LABEL[route]}</Text>
                {selected && <Check color={colors.success} size={18} />}
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole='radio'
            accessibilityState={{ checked: !remoteAudioOn }}
            onPress={onTurnOff}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <VolumeX color={colors.destructive} size={18} />
            <Text style={styles.optionText}>Off</Text>
            {!remoteAudioOn && <Check color={colors.success} size={18} />}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    padding: 16,
  },
  title: { ...mono, color: colors.foreground, fontSize: 11 },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  optionText: { flex: 1, color: colors.foreground, fontSize: 14 },
  pressed: { opacity: 0.7 },
});

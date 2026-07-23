import { ROOM_TEMPLATE_CATALOG, type RoomTemplateDefinition } from '@tether/contracts/modules/room';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, mono } from '@/lib/theme';

interface RoomTemplatePickerProps {
  readonly selected: RoomTemplateDefinition;
  readonly onSelect: (template: RoomTemplateDefinition) => void;
  readonly onContinue: () => void;
  readonly onBack: () => void;
}

export function RoomTemplatePicker({
  selected,
  onSelect,
  onContinue,
  onBack,
}: RoomTemplatePickerProps) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>New call — Choose a room</Text>
        <Text style={styles.title}>Where should you meet?</Text>
        <Text style={styles.description}>
          Watch Together rooms let a web or desktop peer present while this device watches and
          controls playback.
        </Text>
      </View>

      <View style={styles.options}>
        {ROOM_TEMPLATE_CATALOG.map((template) => {
          const isSelected = template.id === selected.id;
          return (
            <Pressable
              key={template.id}
              accessibilityRole='radio'
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(template)}
              style={({ pressed }) => [
                styles.option,
                isSelected && styles.selectedOption,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.optionHeading}>
                <Text style={styles.optionName}>{template.name}</Text>
                <View style={[styles.radio, isSelected && styles.selectedRadio]} />
              </View>
              <Text style={styles.optionDescription}>{template.description}</Text>
              <Text
                style={[styles.capability, template.features.watchAlong && styles.watchCapability]}
              >
                {template.features.watchAlong
                  ? 'Watch Together · Receive and control'
                  : 'Private call'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole='button'
          onPress={onContinue}
          style={({ pressed }) => [styles.continueButton, pressed && styles.pressed]}
        >
          <Text style={styles.continueText}>Continue</Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: 20,
    gap: 28,
  },
  heading: { gap: 10 },
  eyebrow: { ...mono, color: colors.mutedForeground, fontSize: 11 },
  title: { color: colors.foreground, fontSize: 30, fontWeight: '600' },
  description: { color: colors.mutedForeground, fontSize: 14, lineHeight: 21 },
  options: { gap: 12 },
  option: {
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 6,
    padding: 16,
  },
  selectedOption: { borderColor: colors.brand },
  optionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  optionName: { color: colors.foreground, fontSize: 17, fontWeight: '600' },
  optionDescription: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  capability: {
    ...mono,
    color: colors.mutedForeground,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  watchCapability: { color: colors.brand },
  radio: {
    width: 14,
    height: 14,
    borderWidth: 1,
    borderColor: colors.mutedForeground,
    borderRadius: 7,
  },
  selectedRadio: { borderWidth: 4, borderColor: colors.brand },
  actions: { gap: 10 },
  continueButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingVertical: 12,
  },
  continueText: { color: colors.background, fontSize: 15, fontWeight: '600' },
  backButton: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 12,
  },
  backText: { color: colors.foreground, fontSize: 15, fontWeight: '500' },
  pressed: { opacity: 0.7 },
});

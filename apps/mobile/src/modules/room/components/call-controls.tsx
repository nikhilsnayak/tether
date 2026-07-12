import {
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Video,
  VideoOff,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, mono } from '@/lib/theme';

import type { AudioRoute } from '../audio-output';

function ControlButton({
  label,
  caption,
  danger = false,
  indicator = false,
  onPress,
  children,
}: {
  readonly label: string;
  readonly caption: string;
  readonly danger?: boolean;
  readonly indicator?: boolean;
  readonly onPress: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, danger && styles.danger, pressed && styles.pressed]}
    >
      {children}
      <Text style={[styles.caption, danger && styles.captionDanger]}>{caption}</Text>
      {indicator && <View style={styles.indicator} />}
    </Pressable>
  );
}

export function CallControls({
  micOn,
  cameraOn,
  remoteAudioOn,
  selectedAudioRoute,
  hasUnread,
  onMicToggle,
  onCameraToggle,
  onOpenAudio,
  onLeave,
  onOpenChat,
}: {
  readonly micOn: boolean;
  readonly cameraOn: boolean;
  readonly remoteAudioOn: boolean;
  readonly selectedAudioRoute: AudioRoute;
  readonly hasUnread: boolean;
  readonly onMicToggle: () => void;
  readonly onCameraToggle: () => void;
  readonly onOpenAudio: () => void;
  readonly onLeave: () => void;
  readonly onOpenChat: () => void;
}) {
  const audioIcon = !remoteAudioOn ? (
    <VolumeX color={colors.destructive} size={22} />
  ) : selectedAudioRoute === 'SPEAKER_PHONE' ? (
    <Volume2 color={colors.foreground} size={22} />
  ) : (
    <Volume1 color={colors.foreground} size={22} />
  );
  return (
    <View style={styles.controls}>
      <ControlButton
        label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        caption='mic'
        danger={!micOn}
        onPress={onMicToggle}
      >
        {micOn ? (
          <Mic color={colors.foreground} size={22} />
        ) : (
          <MicOff color={colors.destructive} size={22} />
        )}
      </ControlButton>
      <ControlButton
        label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        caption='cam'
        danger={!cameraOn}
        onPress={onCameraToggle}
      >
        {cameraOn ? (
          <Video color={colors.foreground} size={22} />
        ) : (
          <VideoOff color={colors.destructive} size={22} />
        )}
      </ControlButton>
      <ControlButton
        label='Audio output'
        caption='out'
        danger={!remoteAudioOn}
        onPress={onOpenAudio}
      >
        {audioIcon}
      </ControlButton>
      <ControlButton label='Leave call' caption='end' danger onPress={onLeave}>
        <PhoneOff color={colors.destructive} size={22} />
      </ControlButton>
      <ControlButton
        label={hasUnread ? 'Open chat (unread messages)' : 'Open chat'}
        caption='chat'
        indicator={hasUnread}
        onPress={onOpenChat}
      >
        <MessageSquare color={colors.foreground} size={22} />
      </ControlButton>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: 12,
  },
  button: {
    flex: 1,
    maxWidth: 64,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: colors.secondary,
    borderRadius: 4,
  },
  danger: { backgroundColor: colors.destructiveMuted },
  caption: { ...mono, color: colors.foreground, fontSize: 9 },
  captionDanger: { color: colors.destructive },
  indicator: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand,
  },
  pressed: { opacity: 0.7 },
});

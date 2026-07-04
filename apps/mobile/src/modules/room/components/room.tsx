import { useAtomValue } from '@effect/atom-react';
import {
  isPeerSessionErrorStatus,
  peerLocalStreamAtom,
  peerRemoteStreamAtom,
  peerSessionStatusPresentation,
  peerSessionViewAtom,
  type PeerSessionStatusPresentation,
  type RoomSession,
} from '@tether/client-runtime/modules/room';
import { Mic, MicOff, PhoneOff, ShieldCheck, User, Video, VideoOff } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RTCView, type MediaStream } from 'react-native-webrtc';

import { LogoMark, Wordmark } from '@/components/logo';
import { colors, mono } from '@/lib/theme';

import { usePeerConnection } from '../hooks/use-peer-connection';
import { mediaStreamValue } from '../peer-session/platform';

// The dot stays static here; the web's pulse animation has no cheap RN equivalent.
const INDICATOR_TONE_COLOR = {
  success: colors.success,
  warning: colors.warning,
  destructive: colors.destructive,
  muted: colors.mutedForeground,
} satisfies Record<PeerSessionStatusPresentation['tone'], string>;

const statusIndicatorColor = (presentation: PeerSessionStatusPresentation) =>
  INDICATOR_TONE_COLOR[presentation.tone];

function CallStatusScreen({
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
  readonly action?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.statusScreen}>
      <View style={styles.statusHeader}>
        <Wordmark size={20} />
        <View style={styles.statusPill}>
          <View style={[styles.indicatorDot, { backgroundColor: indicatorColor }]} />
          <Text style={styles.pillText}>{pillLabel}</Text>
        </View>
      </View>
      <View style={styles.statusBody}>
        <View style={styles.statusFrame}>
          <View style={[styles.statusFrameDot, { backgroundColor: indicatorColor }]} />
        </View>
        <Text style={styles.statusLabel}>{label}</Text>
        <Text style={styles.statusHint}>{hint}</Text>
        {action !== undefined && <View style={styles.statusAction}>{action}</View>}
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

export function CallScreen({
  onLeaveRoom,
  session,
}: {
  readonly onLeaveRoom: () => void;
  readonly session: RoomSession;
}) {
  const { leave } = usePeerConnection({
    input: { roomId: session.roomId, selfId: session.selfId },
  });
  const view = useAtomValue(peerSessionViewAtom);
  const localStreamHandle = useAtomValue(peerLocalStreamAtom);
  const remoteStreamHandle = useAtomValue(peerRemoteStreamAtom);
  const localStream = localStreamHandle === null ? null : mediaStreamValue(localStreamHandle);
  const remoteStream = remoteStreamHandle === null ? null : mediaStreamValue(remoteStreamHandle);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sasConfirmed, setSasConfirmed] = useState(false);

  // Every new code (fresh session or reconnect) must be re-confirmed.
  useEffect(() => {
    setSasConfirmed(false);
  }, [view.sas]);

  const presentation = peerSessionStatusPresentation(view.status);
  const handleLeave = () => {
    void leave().then(onLeaveRoom, onLeaveRoom);
  };
  const handleMicToggle = () => {
    const enabled = !micOn;

    for (const track of localStream?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }

    setMicOn(enabled);
  };
  const handleCameraToggle = () => {
    const enabled = !camOn;

    for (const track of localStream?.getVideoTracks() ?? []) {
      track.enabled = enabled;
    }

    setCamOn(enabled);
  };

  if (isPeerSessionErrorStatus(view.status)) {
    return (
      <CallStatusScreen
        indicatorColor={statusIndicatorColor(presentation)}
        pillLabel={presentation.label}
        label={presentation.label}
        hint={presentation.hint}
        action={<ActionButton label='Back to room setup' onPress={onLeaveRoom} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.stage}>
        {remoteStream ? (
          <RemoteVideo stream={remoteStream} />
        ) : (
          <View style={styles.stagePlaceholder}>
            <View style={styles.statusFrame}>
              <User color={colors.mutedForeground} size={36} strokeWidth={1.5} />
            </View>
            <Text style={styles.statusLabel}>{presentation.label}</Text>
            <Text style={styles.statusHint}>{presentation.hint}</Text>
          </View>
        )}

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <LogoMark size={20} />
            {/* Dot-only pill, like the web at phone widths. */}
            <View accessibilityLabel={presentation.label} style={styles.statusPill}>
              <View
                style={[
                  styles.indicatorDot,
                  { backgroundColor: statusIndicatorColor(presentation) },
                ]}
              />
            </View>
          </View>
          <View style={styles.roomBadge}>
            <Text style={styles.pillText}>{session.roomId}</Text>
          </View>
        </View>

        <SelfPreview stream={localStream} cameraOn={camOn} />

        {view.sas !== null && !sasConfirmed && (
          <SafetyCard
            code={view.sas}
            onMismatch={handleLeave}
            onConfirm={() => setSasConfirmed(true)}
          />
        )}
        {view.sas !== null && sasConfirmed && (
          <Pressable
            accessibilityLabel='Safety code'
            onPress={() => setSasConfirmed(false)}
            style={styles.sasBadge}
          >
            <ShieldCheck color={colors.foreground} size={14} />
          </Pressable>
        )}
      </View>

      <View style={styles.controls}>
        <ControlButton
          label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          caption='mic'
          danger={!micOn}
          onPress={handleMicToggle}
        >
          {micOn ? (
            <Mic color={colors.foreground} size={22} />
          ) : (
            <MicOff color={colors.destructive} size={22} />
          )}
        </ControlButton>
        <ControlButton
          label={camOn ? 'Turn camera off' : 'Turn camera on'}
          caption='cam'
          danger={!camOn}
          onPress={handleCameraToggle}
        >
          {camOn ? (
            <Video color={colors.foreground} size={22} />
          ) : (
            <VideoOff color={colors.destructive} size={22} />
          )}
        </ControlButton>
        <ControlButton label='Leave call' caption='end' danger onPress={handleLeave}>
          <PhoneOff color={colors.destructive} size={22} />
        </ControlButton>
      </View>
    </SafeAreaView>
  );
}

function RemoteVideo({ stream }: { readonly stream: MediaStream }) {
  return <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit='cover' />;
}

function SelfPreview({
  stream,
  cameraOn,
}: {
  readonly stream: MediaStream | null;
  readonly cameraOn: boolean;
}) {
  // Tile mirrors the device aspect ratio, like the web's viewport-shaped tile.
  const { width, height } = useWindowDimensions();
  const aspectRatio = height > 0 ? width / height : 1;
  const tileWidth = Math.min(Math.max(width * 0.3, 112), aspectRatio > 1 ? 224 : 144);

  return (
    <View style={[styles.selfTile, { width: tileWidth, aspectRatio }]}>
      {stream !== null && cameraOn ? (
        <RTCView streamURL={stream.toURL()} style={styles.selfVideo} objectFit='cover' mirror />
      ) : (
        <View style={styles.selfVideoOff}>
          <Text style={styles.pillText}>cam off</Text>
        </View>
      )}
      <View style={styles.selfCaptionChip}>
        <Text style={styles.selfCaption}>You</Text>
      </View>
    </View>
  );
}

function SafetyCard({
  code,
  onMismatch,
  onConfirm,
}: {
  readonly code: string;
  readonly onMismatch: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <View accessibilityLabel='Safety check' style={styles.safetyCard}>
      <View style={styles.safetyTitleRow}>
        <ShieldCheck color={colors.foreground} size={16} />
        <Text style={styles.safetyTitle}>Safety check</Text>
      </View>
      <Text accessibilityLabel='Safety code' style={styles.safetyCode}>
        {code}
      </Text>
      <Text style={styles.statusHint}>
        Read this code aloud to each other. It proves that no one, not even the server, can see this
        call. Trust the call only if you both see the same code.
      </Text>
      <View style={styles.safetyActions}>
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

function ActionButton({
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
        styles.actionButton,
        variant === 'primary' && styles.actionButtonPrimary,
        variant === 'danger' && styles.actionButtonDanger,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          variant === 'primary' && styles.actionButtonTextOnBrand,
          variant === 'danger' && styles.actionButtonTextDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ControlButton({
  label,
  caption,
  danger = false,
  onPress,
  children,
}: {
  readonly label: string;
  readonly caption: string;
  readonly danger?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlButton,
        danger && styles.controlButtonDanger,
        pressed && styles.pressed,
      ]}
    >
      {children}
      <Text style={[styles.controlCaption, danger && styles.controlCaptionDanger]}>{caption}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  stage: { flex: 1, overflow: 'hidden' },
  stagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: `${colors.background}b3`,
    borderRadius: 6,
    padding: 8,
    flexShrink: 1,
  },
  roomBadge: {
    backgroundColor: colors.secondary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sasBadge: {
    position: 'absolute',
    top: 52,
    right: 12,
    backgroundColor: colors.secondary,
    borderRadius: 6,
    padding: 7,
  },
  indicatorDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { ...mono, color: colors.foreground, fontSize: 11 },
  selfTile: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  selfVideo: { flex: 1 },
  selfVideoOff: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  selfCaptionChip: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    backgroundColor: `${colors.background}80`,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  selfCaption: { ...mono, color: colors.foreground, fontSize: 9 },
  safetyCard: {
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
  safetyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  safetyTitle: { ...mono, color: colors.foreground, fontSize: 11 },
  safetyCode: {
    ...mono,
    color: colors.foreground,
    fontSize: 17,
    textAlign: 'center',
    letterSpacing: 3,
  },
  safetyActions: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  actionButtonPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  actionButtonDanger: {
    backgroundColor: colors.destructiveMuted,
    borderColor: 'transparent',
  },
  actionButtonText: { color: colors.foreground, fontSize: 13, fontWeight: '500' },
  actionButtonTextOnBrand: { color: colors.background, fontWeight: '600' },
  actionButtonTextDanger: { color: colors.destructive },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: 16,
  },
  controlButton: {
    width: 64,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: colors.secondary,
    borderRadius: 4,
  },
  controlButtonDanger: { backgroundColor: colors.destructiveMuted },
  controlCaption: { ...mono, color: colors.foreground, fontSize: 9 },
  controlCaptionDanger: { color: colors.destructive },
  pressed: { opacity: 0.7 },
  statusScreen: { flex: 1, backgroundColor: colors.background, padding: 16 },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  statusFrame: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 8,
  },
  statusFrameDot: { width: 10, height: 10, borderRadius: 5 },
  statusAction: { marginTop: 12 },
  statusLabel: { ...mono, color: colors.foreground, fontSize: 13, textAlign: 'center' },
  statusHint: { color: colors.mutedForeground, fontSize: 13, textAlign: 'center' },
});

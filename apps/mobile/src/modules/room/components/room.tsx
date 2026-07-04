import { useAtomValue } from '@effect/atom-react';
import {
  isPeerSessionErrorStatus,
  peerLocalStreamAtom,
  peerRemoteStreamAtom,
  peerSessionStatusPresentation,
  peerSessionViewAtom,
  type PeerSessionStatusPresentation,
  type PeerSessionView,
  type RoomSession,
} from '@tether/client-runtime/modules/room';
import { useKeepAwake } from 'expo-keep-awake';
import {
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  SendHorizontal,
  ShieldCheck,
  User,
  Video,
  VideoOff,
  Volume1,
  Volume2,
  X,
} from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import InCallManager from 'react-native-incall-manager';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
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
  useKeepAwake();
  const { leave, sendMessage } = usePeerConnection({
    input: { roomId: session.roomId, selfId: session.selfId },
  });
  const view = useAtomValue(peerSessionViewAtom);
  const localStreamHandle = useAtomValue(peerLocalStreamAtom);
  const remoteStreamHandle = useAtomValue(peerRemoteStreamAtom);
  const localStream = localStreamHandle === null ? null : mediaStreamValue(localStreamHandle);
  const remoteStream = remoteStreamHandle === null ? null : mediaStreamValue(remoteStreamHandle);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [readCount, setReadCount] = useState(view.messages.length);
  // Compared against view.sas, so a new code (reconnect) is unconfirmed by construction.
  const [confirmedSas, setConfirmedSas] = useState<string | null>(null);
  const sasConfirmed = view.sas !== null && confirmedSas === view.sas;
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const messageCount = view.messages.length;
  const hasUnread = !chatOpen && messageCount > readCount;
  const isConnected = view.status === 'connected';

  // Route call audio through the loudspeaker, like the web defaults to system
  // output. The try guards a dev client built without the native module.
  useEffect(() => {
    try {
      InCallManager.start({ media: 'video' });
      InCallManager.setForceSpeakerphoneOn(true);
    } catch {
      return;
    }
    return () => InCallManager.stop();
  }, []);

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
  const handleSpeakerToggle = () => {
    const enabled = !speakerOn;

    try {
      InCallManager.setForceSpeakerphoneOn(enabled);
    } catch {
      return;
    }

    setSpeakerOn(enabled);
  };
  const closeChat = () => {
    setChatOpen(false);
    setReadCount(messageCount);
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
      <View
        style={styles.stage}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setStageSize({ width, height });
        }}
      >
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

        <SelfPreview stream={localStream} cameraOn={camOn} stage={stageSize} />

        {view.sas !== null && !sasConfirmed && (
          <SafetyCard
            code={view.sas}
            onMismatch={handleLeave}
            onConfirm={() => setConfirmedSas(view.sas)}
          />
        )}
        {view.sas !== null && sasConfirmed && (
          <Pressable
            accessibilityLabel='Safety code'
            onPress={() => setConfirmedSas(null)}
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
        <ControlButton
          label={speakerOn ? 'Switch to earpiece' : 'Switch to speaker'}
          caption='out'
          onPress={handleSpeakerToggle}
        >
          {speakerOn ? (
            <Volume2 color={colors.foreground} size={22} />
          ) : (
            <Volume1 color={colors.foreground} size={22} />
          )}
        </ControlButton>
        <ControlButton label='Leave call' caption='end' danger onPress={handleLeave}>
          <PhoneOff color={colors.destructive} size={22} />
        </ControlButton>
        <ControlButton
          label={hasUnread ? 'Open chat (unread messages)' : 'Open chat'}
          caption='chat'
          indicator={hasUnread}
          onPress={() => setChatOpen(true)}
        >
          <MessageSquare color={colors.foreground} size={22} />
        </ControlButton>
      </View>

      <ChatModal
        open={chatOpen}
        onClose={closeChat}
        messages={view.messages}
        isConnected={isConnected}
        sendMessage={sendMessage}
      />
    </SafeAreaView>
  );
}

function ChatModal({
  open,
  onClose,
  messages,
  isConnected,
  sendMessage,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly messages: PeerSessionView['messages'];
  readonly isConnected: boolean;
  readonly sendMessage: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState('');
  const canSend = isConnected && draft.trim().length > 0;

  const handleSend = () => {
    const message = draft.trim();
    if (message.length === 0 || !isConnected) {
      return;
    }
    if (sendMessage(message)) {
      setDraft('');
    }
  };

  return (
    <Modal visible={open} transparent animationType='slide' onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.chatBackdrop}
      >
        <Pressable accessibilityLabel='Close chat' onPress={onClose} style={styles.chatScrim} />
        <View style={styles.chatSheet}>
          <View style={styles.chatHeader}>
            <View style={styles.chatHeaderText}>
              <Text style={styles.chatTitle}>Chat</Text>
              <Text style={styles.chatDescription}>
                Messages go straight to the other person and disappear when the call ends.
              </Text>
            </View>
            <Pressable accessibilityLabel='Close chat' onPress={onClose} hitSlop={8}>
              <X color={colors.mutedForeground} size={18} />
            </Pressable>
          </View>

          {messages.length === 0 ? (
            <View style={styles.chatEmpty}>
              <Text style={styles.statusHint}>
                No messages yet. Say hello once you are connected.
              </Text>
            </View>
          ) : (
            <FlatList
              // Inverted list sticks to the newest message without scroll math.
              inverted
              data={[...messages].reverse()}
              keyExtractor={(message) => message.id}
              contentContainerStyle={styles.chatList}
              renderItem={({ item }) => (
                <View style={styles.chatRow}>
                  <Text
                    style={[styles.chatSender, item.sender === 'self' && styles.chatSenderSelf]}
                  >
                    {item.sender === 'self' ? 'you' : 'peer'}
                  </Text>
                  <Text style={styles.chatMessage}>{item.text}</Text>
                </View>
              )}
            />
          )}

          <View style={styles.chatComposer}>
            <TextInput
              accessibilityLabel='Message'
              editable={isConnected}
              onChangeText={setDraft}
              onSubmitEditing={handleSend}
              placeholder={isConnected ? 'Write a message' : 'You can chat once connected…'}
              placeholderTextColor={colors.mutedForeground}
              returnKeyType='send'
              submitBehavior='submit'
              style={styles.chatInput}
              value={draft}
            />
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Send message'
              disabled={!canSend}
              onPress={handleSend}
              style={({ pressed }) => [
                styles.sendButton,
                !canSend && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <SendHorizontal color={colors.background} size={18} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RemoteVideo({ stream }: { readonly stream: MediaStream }) {
  return <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit='cover' />;
}

const TILE_MARGIN = 12;
const TILE_SNAP = { stiffness: 500, damping: 40 };

function SelfPreview({
  stream,
  cameraOn,
  stage,
}: {
  readonly stream: MediaStream | null;
  readonly cameraOn: boolean;
  readonly stage: { readonly width: number; readonly height: number };
}) {
  // Tile mirrors the device aspect ratio, like the web's viewport-shaped tile.
  const { width, height } = useWindowDimensions();
  const aspectRatio = height > 0 ? width / height : 1;
  const tileWidth = Math.min(Math.max(width * 0.3, 112), aspectRatio > 1 ? 224 : 144);
  const tileHeight = tileWidth / aspectRatio;
  const maxX = Math.max(stage.width - tileWidth - TILE_MARGIN, TILE_MARGIN);
  const maxY = Math.max(stage.height - tileHeight - TILE_MARGIN, TILE_MARGIN);
  // Off-screen until the stage is measured, so the first pin lands bottom-right.
  const x = useSharedValue(10_000);
  const y = useSharedValue(10_000);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const scale = useSharedValue(1);

  // Pin to the nearest corner on first measure and whenever the stage resizes.
  useEffect(() => {
    if (stage.width === 0 || stage.height === 0) {
      return;
    }
    x.value = x.value * 2 + tileWidth < stage.width ? TILE_MARGIN : maxX;
    y.value = y.value * 2 + tileHeight < stage.height ? TILE_MARGIN : maxY;
  }, [stage.width, stage.height, tileWidth, tileHeight, maxX, maxY, x, y]);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
      scale.value = withSpring(1.04, TILE_SNAP);
    })
    .onUpdate((event) => {
      x.value = Math.min(Math.max(startX.value + event.translationX, TILE_MARGIN), maxX);
      y.value = Math.min(Math.max(startY.value + event.translationY, TILE_MARGIN), maxY);
    })
    .onEnd(() => {
      x.value = withSpring(x.value * 2 + tileWidth < stage.width ? TILE_MARGIN : maxX, TILE_SNAP);
      y.value = withSpring(y.value * 2 + tileHeight < stage.height ? TILE_MARGIN : maxY, TILE_SNAP);
    })
    .onFinalize(() => {
      scale.value = withSpring(1, TILE_SNAP);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.selfTile, { width: tileWidth, aspectRatio }, animatedStyle]}>
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
      </Animated.View>
    </GestureDetector>
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
  indicator = false,
  onPress,
  children,
}: {
  readonly label: string;
  readonly caption: string;
  readonly danger?: boolean;
  readonly indicator?: boolean;
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
      {indicator && <View style={styles.controlIndicator} />}
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
    top: 0,
    left: 0,
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
  controlIndicator: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand,
  },
  chatBackdrop: { flex: 1, justifyContent: 'flex-end' },
  chatScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  chatSheet: {
    maxHeight: '75%',
    minHeight: '55%',
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    padding: 16,
  },
  chatHeaderText: { flex: 1, gap: 4 },
  chatTitle: { ...mono, color: colors.foreground, fontSize: 11 },
  chatDescription: { color: colors.mutedForeground, fontSize: 12 },
  chatEmpty: { flex: 1, justifyContent: 'center', padding: 24 },
  chatList: { padding: 16, gap: 14 },
  chatRow: { flexDirection: 'row', gap: 12 },
  chatSender: {
    ...mono,
    color: colors.mutedForeground,
    fontSize: 10,
    width: 44,
    textAlign: 'right',
    paddingTop: 2,
  },
  chatSenderSelf: { color: colors.brand },
  chatMessage: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    paddingLeft: 12,
    color: colors.foreground,
    fontSize: 13,
    lineHeight: 19,
  },
  chatComposer: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: 12,
  },
  chatInput: {
    flex: 1,
    color: colors.foreground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    backgroundColor: colors.brand,
    borderRadius: 6,
  },
  disabled: { opacity: 0.4 },
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

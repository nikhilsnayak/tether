import { useAtomValue } from '@effect/atom-react';
import {
  peerLocalStreamAtom,
  peerRemoteStreamAtom,
  peerSessionStatusPresentation,
  peerSessionViewAtom,
  type PeerSessionStatusPresentation,
} from '@tether/client-runtime/modules/room';
import { ShieldCheck, User } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MediaStream } from 'react-native-webrtc';

import { LogoMark } from '@/components/logo';
import { colors, mono } from '@/lib/theme';

import { mediaStreamValue } from '../peer-session/platform';
import type { MobileWatchPresentation } from '../watch-along/presentation';
import { RemoteVideo, SelfPreview } from './media-stage';
import { SafetyCodeCard } from './safety-code-card';

const INDICATOR_TONE_COLOR = {
  success: colors.success,
  warning: colors.warning,
  destructive: colors.destructive,
  muted: colors.mutedForeground,
} satisfies Record<PeerSessionStatusPresentation['tone'], string>;

export function CallStage({
  cameraOn,
  onLeave,
  programStream,
  watchPresentation,
}: {
  readonly cameraOn: boolean;
  readonly onLeave: () => void;
  readonly programStream: MediaStream | null;
  readonly watchPresentation: MobileWatchPresentation;
}) {
  const view = useAtomValue(peerSessionViewAtom);
  const localHandle = useAtomValue(peerLocalStreamAtom);
  const remoteHandle = useAtomValue(peerRemoteStreamAtom);
  const localStream = localHandle === null ? null : mediaStreamValue(localHandle);
  const remoteStream = remoteHandle === null ? null : mediaStreamValue(remoteHandle);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [confirmedSas, setConfirmedSas] = useState<string | null>(null);
  const stageRef = useRef<View>(null);
  const presentation = peerSessionStatusPresentation(
    view.status,
    view.detached,
    view.connectionDiagnostic,
  );
  const sasConfirmed = view.sas !== null && confirmedSas === view.sas;
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStageSize({ width, height });
  };
  return (
    <View ref={stageRef} style={styles.stage} onLayout={onLayout}>
      {programStream !== null ? (
        <RemoteVideo objectFit='contain' stream={programStream} />
      ) : remoteStream ? (
        <RemoteVideo stream={remoteStream} />
      ) : (
        <View style={styles.placeholder}>
          <View style={styles.frame}>
            <User color={colors.mutedForeground} size={36} strokeWidth={1.5} />
          </View>
          <Text style={styles.label}>{presentation.label}</Text>
          <Text style={styles.hint}>{presentation.hint}</Text>
        </View>
      )}
      {watchPresentation.active && programStream === null && (
        <View pointerEvents='none' style={styles.watchStatus}>
          <Text style={styles.label}>{watchPresentation.label}</Text>
          <Text style={styles.hint}>{watchPresentation.hint}</Text>
        </View>
      )}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <LogoMark size={20} />
          <View accessibilityLabel={presentation.label} style={styles.pill}>
            <View
              style={[styles.dot, { backgroundColor: INDICATOR_TONE_COLOR[presentation.tone] }]}
            />
          </View>
        </View>
        {view.roomId !== null && (
          <View style={styles.badge}>
            <Text style={styles.pillText}>{view.roomId}</Text>
          </View>
        )}
      </View>
      <SelfPreview stream={localStream} cameraOn={cameraOn} stage={stageSize} />
      {view.sas !== null && !sasConfirmed && (
        <SafetyCodeCard
          code={view.sas}
          onMismatch={onLeave}
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
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  frame: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  label: { ...mono, color: colors.foreground, fontSize: 13, textAlign: 'center' },
  hint: { color: colors.mutedForeground, fontSize: 13, textAlign: 'center' },
  watchStatus: {
    position: 'absolute',
    top: '50%',
    left: 24,
    right: 24,
    alignItems: 'center',
    gap: 8,
    transform: [{ translateY: -32 }],
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
  pill: {
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
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: {
    backgroundColor: colors.secondary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillText: { ...mono, color: colors.foreground, fontSize: 11 },
  sasBadge: {
    position: 'absolute',
    top: 52,
    right: 12,
    backgroundColor: colors.secondary,
    borderRadius: 6,
    padding: 7,
  },
});

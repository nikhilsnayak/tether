import { useAtomValue } from '@effect/atom-react';
import type { PeerSession } from '@tether/client-runtime/modules/room';
import {
  watchProgramStreamAtom,
  watchViewAtom,
  type WatchControlCommand,
  type WatchSessionView,
} from '@tether/client-runtime/modules/watch-along';
import { Minimize2, Pause, Play, RotateCcw, Volume1, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  AppState,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RTCView, type MediaStream } from 'react-native-webrtc';

import { colors, mono } from '@/lib/theme';

import { useProgramAudioVolume } from '../hooks/use-program-audio-volume';
import { mediaStreamValue } from '../peer-session/platform';
import { clampProgramVolume } from '../watch-along/program-audio';
import {
  classifyProgramPipelineSignal,
  hasPlayerReadinessExpired,
  startPlayerReadinessDeadline,
  type ProgramPipelineSignal,
} from '../watch-along/program-pipeline';
import { clampSeekFraction, watchControlsForView } from '../watch-along/watch-controls';
import { WatchPlayerBoundary } from './watch-player-boundary';

type WatchController = PeerSession['watch'];

function NativeWatchPlayer({
  stream,
  volume,
  failPipeline,
  interrupted,
}: {
  readonly stream: MediaStream;
  readonly volume: number;
  readonly failPipeline: WatchController['failPipeline'];
  readonly interrupted: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  useProgramAudioVolume(stream, volume, failPipeline, interrupted);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (ready || !foreground) return;
    const deadline = startPlayerReadinessDeadline(Date.now());
    const timeout = setTimeout(() => {
      if (!hasPlayerReadinessExpired(deadline, Date.now())) return;
      const reason = classifyProgramPipelineSignal('readiness-timeout', {
        active: true,
        interrupted,
        tearingDown: false,
      });
      if (reason !== null) failPipeline(reason);
    }, 5_000);
    return () => clearTimeout(timeout);
  }, [failPipeline, foreground, interrupted, ready]);

  useEffect(() => {
    if (!foreground) return;
    const interval = setInterval(() => {
      if (!stream.getTracks().some((track) => track.readyState === 'ended')) return;
      const reason = classifyProgramPipelineSignal('track-ended', {
        active: true,
        interrupted,
        tearingDown: false,
      });
      if (reason !== null) failPipeline(reason);
    }, 1_000);
    return () => clearInterval(interval);
  }, [failPipeline, foreground, interrupted, stream]);

  return (
    <RTCView
      streamURL={stream.toURL()}
      style={StyleSheet.absoluteFill}
      objectFit='contain'
      onDimensionsChange={({ nativeEvent }) => {
        if (nativeEvent.width > 0 && nativeEvent.height > 0) setReady(true);
      }}
    />
  );
}

function WatchControlButton({
  label,
  enabled = true,
  onPress,
  children,
}: {
  readonly label: string;
  readonly enabled?: boolean;
  readonly onPress: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlButton,
        !enabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

function ActiveWatchStage({
  watch,
  view,
}: {
  readonly watch: WatchController;
  readonly view: WatchSessionView;
}) {
  const streamHandle = useAtomValue(watchProgramStreamAtom);
  const stream = streamHandle === null ? null : mediaStreamValue(streamHandle);
  const [collapsed, setCollapsed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [seekWidth, setSeekWidth] = useState(0);
  const [volume, setVolume] = useState(1);
  const controls = watchControlsForView(view, collapsed);

  const fail = (signal: ProgramPipelineSignal) => {
    const reason = classifyProgramPipelineSignal(signal, {
      active: view.role !== null && stream !== null,
      interrupted: view.status === 'awaiting-recovery-snapshot',
      tearingDown: false,
    });
    if (reason !== null) watch.failPipeline(reason);
  };
  const dispatch = (control: WatchControlCommand) => {
    watch.control(control);
  };
  const seekFraction = (event: GestureResponderEvent) =>
    clampSeekFraction(event.nativeEvent.locationX / seekWidth);
  const updateSeekPreview = (event: GestureResponderEvent) => {
    setSeekPreview(seekFraction(event));
  };
  const finishSeek = (event: GestureResponderEvent) => {
    const target = seekFraction(event);
    setSeekPreview(null);
    dispatch({ kind: 'seek', target });
  };
  const primary = controls.primary.kind;
  const progress = seekPreview ?? view.progress;

  if (!controls.fullStage) {
    return (
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Expand watch player'
        onPress={() => setCollapsed(false)}
        style={styles.expandBadge}
      >
        <Play color={colors.foreground} size={16} />
        <Text style={styles.badgeText}>watch</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.watchStage}>
      {stream === null ? (
        <View style={styles.treatment}>
          <Text style={styles.feedback}>{controls.feedback}</Text>
        </View>
      ) : (
        <WatchPlayerBoundary onFailure={() => fail('render-error')}>
          <NativeWatchPlayer
            key={stream.toURL()}
            stream={stream}
            volume={volume}
            failPipeline={watch.failPipeline}
            interrupted={view.status === 'awaiting-recovery-snapshot'}
          />
        </WatchPlayerBoundary>
      )}
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={controlsVisible ? 'Hide watch controls' : 'Show watch controls'}
        onPress={() => setControlsVisible((visible) => !visible)}
        style={StyleSheet.absoluteFill}
      />
      {controlsVisible && (
        <View style={styles.overlay} pointerEvents='box-none'>
          <View style={styles.topBar}>
            <Text style={styles.feedback}>{controls.feedback}</Text>
            <WatchControlButton label='Collapse watch player' onPress={() => setCollapsed(true)}>
              <Minimize2 color={colors.foreground} size={19} />
            </WatchControlButton>
          </View>
          <View style={styles.controlPanel}>
            {controls.seek.visible && (
              <View
                accessibilityLabel='Watch seek'
                onLayout={(event: LayoutChangeEvent) =>
                  setSeekWidth(event.nativeEvent.layout.width)
                }
                onStartShouldSetResponder={() => controls.seek.enabled && seekWidth > 0}
                onMoveShouldSetResponder={() => controls.seek.enabled && seekWidth > 0}
                onResponderGrant={updateSeekPreview}
                onResponderMove={updateSeekPreview}
                onResponderRelease={finishSeek}
                onResponderTerminate={() => setSeekPreview(null)}
                style={styles.seekTrack}
              >
                <View style={[styles.seekProgress, { width: `${progress * 100}%` }]} />
                <View style={[styles.seekHandle, { left: `${progress * 100}%` }]} />
              </View>
            )}
            <View style={styles.controlRow}>
              {primary !== null && (
                <WatchControlButton
                  label={primary === 'play' ? 'Play' : primary === 'pause' ? 'Pause' : 'Replay'}
                  enabled={controls.primary.enabled}
                  onPress={() => dispatch({ kind: primary })}
                >
                  {primary === 'play' ? (
                    <Play color={colors.foreground} size={22} />
                  ) : primary === 'pause' ? (
                    <Pause color={colors.foreground} size={22} />
                  ) : (
                    <RotateCcw color={colors.foreground} size={22} />
                  )}
                </WatchControlButton>
              )}
              <View style={styles.volumeControl}>
                <Volume1 color={colors.mutedForeground} size={18} />
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel='Lower program volume'
                  onPress={() => setVolume((current) => clampProgramVolume(current - 0.1))}
                  style={styles.volumeButton}
                >
                  <Text style={styles.volumeText}>−</Text>
                </Pressable>
                <Text accessibilityLabel='Program volume' style={styles.volumeValue}>
                  {Math.round(volume * 100)}
                </Text>
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel='Raise program volume'
                  onPress={() => setVolume((current) => clampProgramVolume(current + 0.1))}
                  style={styles.volumeButton}
                >
                  <Text style={styles.volumeText}>+</Text>
                </Pressable>
              </View>
              <WatchControlButton
                label='Eject video'
                enabled={controls.eject.enabled}
                onPress={() => dispatch({ kind: 'eject' })}
              >
                <X color={colors.destructive} size={22} />
              </WatchControlButton>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

export function WatchStage({ watch }: { readonly watch: WatchController }) {
  const view = useAtomValue(watchViewAtom);
  return view.role === null ? null : <ActiveWatchStage watch={watch} view={view} />;
}

const styles = StyleSheet.create({
  watchStage: {
    position: 'absolute',
    inset: 0,
    backgroundColor: colors.background,
    zIndex: 10,
  },
  treatment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', inset: 0, justifyContent: 'space-between', padding: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feedback: { ...mono, color: colors.foreground, fontSize: 12 },
  controlPanel: {
    gap: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: `${colors.background}e6`,
    borderRadius: 6,
  },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlButton: {
    width: 46,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
    borderRadius: 4,
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  seekTrack: { height: 18, justifyContent: 'center', backgroundColor: colors.secondary },
  seekProgress: { position: 'absolute', left: 0, height: 3, backgroundColor: colors.brand },
  seekHandle: {
    position: 'absolute',
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
    backgroundColor: colors.foreground,
  },
  volumeControl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  volumeButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
    borderRadius: 4,
  },
  volumeText: { color: colors.foreground, fontSize: 18 },
  volumeValue: { ...mono, width: 32, color: colors.foreground, fontSize: 10, textAlign: 'center' },
  expandBadge: {
    position: 'absolute',
    top: 62,
    left: 12,
    zIndex: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.brand,
    borderRadius: 4,
  },
  badgeText: { ...mono, color: colors.foreground, fontSize: 10 },
});

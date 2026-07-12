import { useAtomValue } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/peer-session';
import {
  isPeerSessionErrorStatus,
  peerLocalStreamAtom,
  peerRemoteStreamAtom,
  peerSessionStatusPresentation,
  peerSessionViewAtom,
} from '@tether/client-runtime/modules/room';
import type { PeerId } from '@tether/contracts/modules/room';
import { useKeepAwake } from 'expo-keep-awake';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/lib/theme';

import { type AudioRoute } from '../audio-output';
import { useCallAudioRouting } from '../hooks/use-call-audio-routing';
import { usePeerConnection } from '../hooks/use-peer-connection';
import { useRemoteAudioVolume } from '../hooks/use-remote-audio-volume';
import { mediaStreamValue } from '../peer-session/platform';
import { ActionButton } from './action-button';
import { AudioOutputModal } from './audio-output-modal';
import { CallControls } from './call-controls';
import { CallStage } from './call-stage';
import { CallStatusScreen } from './call-status-screens';
import { ChatModal } from './chat-modal';
import { JoinRequestModal } from './join-request-modal';

export function CallScreen({
  onLeaveRoom,
  session,
}: {
  readonly onLeaveRoom: () => void;
  readonly session: RoomSession;
}) {
  useKeepAwake();
  const { leave, sendMessage, respondToJoin } = usePeerConnection({ input: session });
  const view = useAtomValue(peerSessionViewAtom);
  const localHandle = useAtomValue(peerLocalStreamAtom);
  const remoteHandle = useAtomValue(peerRemoteStreamAtom);
  const localStream = localHandle === null ? null : mediaStreamValue(localHandle);
  const remoteStream = remoteHandle === null ? null : mediaStreamValue(remoteHandle);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [remoteAudioOn, setRemoteAudioOn] = useState(true);
  const [audioOutputOpen, setAudioOutputOpen] = useState(false);
  const { availableAudioRoutes, selectedAudioRoute, selectAudioRoute } = useCallAudioRouting();
  const [chatOpen, setChatOpen] = useState(false);
  const [readCount, setReadCount] = useState(view.messages.length);
  const [handlingJoinPeerIds, setHandlingJoinPeerIds] = useState<ReadonlySet<PeerId>>(new Set());
  const messageCount = view.messages.length;
  const hasUnread = !chatOpen && messageCount > readCount;
  const presentation = peerSessionStatusPresentation(view.status);
  const pendingJoin =
    view.pendingJoinRequests.find((request) => !handlingJoinPeerIds.has(request.peerId)) ?? null;

  useRemoteAudioVolume(remoteStream, remoteAudioOn);
  const handleLeave = () => void leave().then(onLeaveRoom, onLeaveRoom);
  const handleMicToggle = () => {
    const enabled = !micOn;
    for (const track of localStream?.getAudioTracks() ?? []) track.enabled = enabled;
    setMicOn(enabled);
  };
  const handleCameraToggle = () => {
    const enabled = !cameraOn;
    for (const track of localStream?.getVideoTracks() ?? []) track.enabled = enabled;
    setCameraOn(enabled);
  };
  const handleAudioRouteChange = async (route: AudioRoute) => {
    try {
      await selectAudioRoute(route);
      setRemoteAudioOn(true);
      setAudioOutputOpen(false);
    } catch {}
  };
  const answerJoin = (peerId: PeerId, decision: 'allow' | 'deny') => {
    setHandlingJoinPeerIds((current) => new Set(current).add(peerId));
    const clear = () =>
      setHandlingJoinPeerIds((current) => {
        const next = new Set(current);
        next.delete(peerId);
        return next;
      });
    void respondToJoin(peerId, decision).then(clear, clear);
  };

  if (isPeerSessionErrorStatus(view.status))
    return (
      <CallStatusScreen
        indicatorColor={colors.destructive}
        pillLabel={presentation.label}
        label={presentation.label}
        hint={presentation.hint}
        action={<ActionButton label='Back to room setup' onPress={onLeaveRoom} />}
      />
    );
  return (
    <SafeAreaView style={styles.screen}>
      <CallStage cameraOn={cameraOn} onLeave={handleLeave} />
      <CallControls
        micOn={micOn}
        cameraOn={cameraOn}
        remoteAudioOn={remoteAudioOn}
        selectedAudioRoute={selectedAudioRoute}
        hasUnread={hasUnread}
        onMicToggle={handleMicToggle}
        onCameraToggle={handleCameraToggle}
        onOpenAudio={() => setAudioOutputOpen(true)}
        onLeave={handleLeave}
        onOpenChat={() => setChatOpen(true)}
      />
      <AudioOutputModal
        open={audioOutputOpen}
        availableRoutes={availableAudioRoutes}
        selectedRoute={selectedAudioRoute}
        remoteAudioOn={remoteAudioOn}
        onClose={() => setAudioOutputOpen(false)}
        onSelectRoute={(route) => void handleAudioRouteChange(route)}
        onTurnOff={() => {
          setRemoteAudioOn(false);
          setAudioOutputOpen(false);
        }}
      />
      <ChatModal
        open={chatOpen}
        onClose={() => {
          setChatOpen(false);
          setReadCount(messageCount);
        }}
        messages={view.messages}
        canChat={view.status === 'connected' && view.chatReady}
        sendMessage={sendMessage}
      />
      <JoinRequestModal
        request={pendingJoin}
        onAllow={(peerId) => answerJoin(peerId, 'allow')}
        onDeny={(peerId) => answerJoin(peerId, 'deny')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background } });

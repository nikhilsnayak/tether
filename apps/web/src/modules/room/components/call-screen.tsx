import { useAtomValue } from '@effect/atom-react';
import {
  isPeerSessionErrorStatus,
  peerSessionStatusPresentation,
  peerSessionViewAtom,
  type PeerSessionStatusPresentation,
  type RoomSession,
} from '@tether/client-runtime/modules/room';
import { useState } from 'react';

import { usePeerConnection } from '../hooks/use-peer-connection';
import { useScreenWakeLock } from '../hooks/use-screen-wake-lock';
import { CallStage } from './call-stage';
import { CallSessionErrorScreen } from './call-status-screens';
import { ChatDrawer } from './chat-drawer';

const INDICATOR_TONE_CLASS = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground',
} satisfies Record<PeerSessionStatusPresentation['tone'], string>;

const statusIndicatorClassName = (presentation: PeerSessionStatusPresentation) =>
  `${INDICATOR_TONE_CLASS[presentation.tone]}${presentation.pulse ? ' animate-pulse' : ''}`;

export function CallScreen({
  onLeaveRoom,
  session,
}: {
  readonly onLeaveRoom: () => void;
  readonly session: RoomSession;
}) {
  const { leave, sendMessage, respondToJoin } = usePeerConnection({ input: session });
  const view = useAtomValue(peerSessionViewAtom);
  const [chatOpen, setChatOpen] = useState(false);
  const [readCount, setReadCount] = useState(view.messages.length);
  const messageCount = view.messages.length;
  const hasUnread = !chatOpen && messageCount > readCount;
  const presentation = peerSessionStatusPresentation(view.status);

  useScreenWakeLock();

  const handleLeave = () => {
    void leave().then(onLeaveRoom, onLeaveRoom);
  };
  if (isPeerSessionErrorStatus(view.status)) {
    return (
      <CallSessionErrorScreen
        indicatorClassName={statusIndicatorClassName(presentation)}
        label={presentation.label}
        hint={presentation.hint}
        onLeaveRoom={onLeaveRoom}
      />
    );
  }

  return (
    <>
      <CallStage
        session={session}
        respondToJoin={respondToJoin}
        onLeave={handleLeave}
        hasUnread={hasUnread}
        onOpenChat={() => setChatOpen(true)}
      />
      <ChatDrawer
        open={chatOpen}
        onOpenChange={(open) => {
          setChatOpen(open);
          if (!open) setReadCount(messageCount);
        }}
        onSendMessage={sendMessage}
      />
    </>
  );
}

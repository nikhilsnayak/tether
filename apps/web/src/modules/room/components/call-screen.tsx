import { useAtomValue } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/peer-session';
import { peerSessionViewAtom } from '@tether/client-runtime/modules/room';
import { useState } from 'react';

import { usePeerConnection } from '../hooks/use-peer-connection';
import { useScreenWakeLock } from '../hooks/use-screen-wake-lock';
import type { InitialMediaSettings } from '../preflight/media';
import { CallStage } from './call-stage';
import { ChatDrawer } from './chat-drawer';

export function CallScreen({
  onLeaveRoom,
  session,
  initialMediaSettings,
}: {
  readonly onLeaveRoom: () => void;
  readonly session: RoomSession;
  readonly initialMediaSettings: InitialMediaSettings;
}) {
  const { leave, sendMessage, respondToJoin } = usePeerConnection({ input: session });
  const view = useAtomValue(peerSessionViewAtom);
  const [chatOpen, setChatOpen] = useState(false);
  const [readCount, setReadCount] = useState(view.messages.length);
  const messageCount = view.messages.length;
  const hasUnread = !chatOpen && messageCount > readCount;

  useScreenWakeLock();

  const handleLeave = () => {
    void leave().then(onLeaveRoom, onLeaveRoom);
  };
  return (
    <>
      <CallStage
        session={session}
        initialMediaSettings={initialMediaSettings}
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

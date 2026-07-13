import type { RoomSession } from '@tether/client-runtime/modules/peer-session';

import { usePeerConnection } from '../hooks/use-peer-connection';
import { useScreenWakeLock } from '../hooks/use-screen-wake-lock';
import type { InitialMediaSettings } from '../preflight/media';
import { CallStage } from './call-stage';

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

  useScreenWakeLock();

  const handleLeave = () => {
    void leave().then(onLeaveRoom, onLeaveRoom);
  };
  return (
    <CallStage
      session={session}
      initialMediaSettings={initialMediaSettings}
      respondToJoin={respondToJoin}
      onLeave={handleLeave}
      onSendMessage={sendMessage}
    />
  );
}

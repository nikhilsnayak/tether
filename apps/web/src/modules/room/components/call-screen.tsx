import type { RoomSession } from '@tether/client-runtime/modules/peer-session';

import { usePeerConnection } from '../hooks/use-peer-connection';
import { useScreenWakeLock } from '../hooks/use-screen-wake-lock';
import type { PreparedMediaSelection } from '../preflight/media';
import type { RoomTemplate } from '../templates/registry';
import { CallStage } from './call-stage';

export function CallScreen({
  onLeaveRoom,
  session,
  template,
  preparedMedia,
}: {
  readonly onLeaveRoom: () => void;
  readonly session: RoomSession;
  readonly template: RoomTemplate;
  readonly preparedMedia: PreparedMediaSelection;
}) {
  const { leave, sendMessage, respondToJoin } = usePeerConnection({
    session,
    preparedMedia: preparedMedia.media,
  });

  useScreenWakeLock();

  const handleLeave = () => {
    void leave().then(onLeaveRoom, onLeaveRoom);
  };
  return (
    <CallStage
      session={session}
      template={template}
      initialMediaSettings={preparedMedia.settings}
      respondToJoin={respondToJoin}
      onLeave={handleLeave}
      onSendMessage={sendMessage}
    />
  );
}

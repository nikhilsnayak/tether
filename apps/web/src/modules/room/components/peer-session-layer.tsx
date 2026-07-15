import { useAtomSuspense } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/room';

import { peerSessionAtom } from '../peer-session/runtime';
import type { PreparedMediaSelection } from '../preflight/media';
import { CallScreen } from './call-screen';
import { useRoomExperience } from './room-experience-context';

export function PeerSessionLayer({
  session,
  preparedMedia,
  onLeaveRoom,
}: {
  readonly session: RoomSession;
  readonly preparedMedia: PreparedMediaSelection;
  readonly onLeaveRoom: () => void;
}) {
  const { binding } = useRoomExperience();
  useAtomSuspense(peerSessionAtom({ session, preparedMedia: preparedMedia.media, binding }));

  return (
    <CallScreen
      session={session}
      initialMediaSettings={preparedMedia.settings}
      onLeaveRoom={onLeaveRoom}
    />
  );
}

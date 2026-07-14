import { useAtomSuspense } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/peer-session';
import type { PreparedMedia } from '@tether/client-runtime/modules/room';

import { peerSessionAtom } from '../peer-session/runtime';

export function usePeerConnection({
  session,
  preparedMedia,
}: {
  session: RoomSession;
  preparedMedia: PreparedMedia;
}) {
  const peerSession = useAtomSuspense(peerSessionAtom({ session, preparedMedia }));

  return {
    leave: peerSession.value.leave,
    sendAvatarPose: peerSession.value.sendAvatarPose,
    sendMediaState: peerSession.value.sendMediaState,
    sendMessage: peerSession.value.sendMessage,
    respondToJoin: peerSession.value.respondToJoin,
  };
}

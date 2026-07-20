import { useAtomSuspense } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/peer-session';

import { peerSessionAtom } from '../peer-session/runtime';

export function usePeerConnection({ input }: { input: RoomSession }) {
  const session = useAtomSuspense(peerSessionAtom(input));

  return {
    leave: session.value.leave,
    sendMessage: session.value.sendMessage,
    respondToJoin: session.value.respondToJoin,
    watch: session.value.watch,
  };
}

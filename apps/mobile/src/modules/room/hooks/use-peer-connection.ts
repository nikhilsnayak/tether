import { useAtomSuspense } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/room';

import { peerSessionAtom } from '../peer-session/runtime';

export function usePeerConnection({ input }: { input: RoomSession }) {
  const session = useAtomSuspense(peerSessionAtom(input));

  return { leave: session.value.leave, sendMessage: session.value.sendMessage };
}

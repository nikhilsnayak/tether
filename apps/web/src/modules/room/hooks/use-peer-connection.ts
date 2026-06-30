import { useAtomSuspense } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/room';

import { peerSessionAtom } from '../peer-session/atoms';

export function usePeerConnection({ input }: { input: RoomSession }) {
  const session = useAtomSuspense(peerSessionAtom(input));

  return { sendMessage: session.value.sendMessage };
}

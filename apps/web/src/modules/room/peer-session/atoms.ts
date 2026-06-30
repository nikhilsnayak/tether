import { Atom } from 'effect/unstable/reactivity';

import type { PeerSessionView } from './model';

export const peerSessionViewAtom = Atom.make<PeerSessionView>({
  status: 'connecting',
  messages: [],
});

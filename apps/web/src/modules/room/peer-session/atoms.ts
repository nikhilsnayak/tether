import { Atom } from 'effect/unstable/reactivity';

import type { PeerSessionView } from './model';

/**
 * An atom that holds the current state of the peer session view.
 */
export const peerSessionViewAtom = Atom.make<PeerSessionView>({
  status: 'connecting',
  messages: [],
});

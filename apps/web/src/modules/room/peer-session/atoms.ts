import { startPeerSession, type RoomSession } from '@tether/client-runtime/modules/room';
import { Layer } from 'effect';
import { Atom } from 'effect/unstable/reactivity';

import { appClientLayer } from '@/lib/app-client';

import { webPeerSessionPlatformLayer } from './platform';
import { peerSessionEventSinkLayer } from './view';

const peerSessionRuntime = Atom.runtime(
  Layer.mergeAll(appClientLayer, webPeerSessionPlatformLayer, peerSessionEventSinkLayer),
);

/**
 * Owns one scoped peer-session resource per session identity. Atom consumers
 * suspend during acquisition and release the actor and WebRTC resources when
 * the family member is no longer retained.
 */
export const peerSessionAtom = Atom.family((session: RoomSession) =>
  peerSessionRuntime.atom(startPeerSession(session)),
);

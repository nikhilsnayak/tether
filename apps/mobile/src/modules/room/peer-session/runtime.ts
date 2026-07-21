import type { RoomSession } from '@tether/client-runtime/modules/peer-session';
import { peerSessionEventSinkLayer, startPeerSession } from '@tether/client-runtime/modules/room';
import { Layer } from 'effect';
import { Atom } from 'effect/unstable/reactivity';

import { peerSessionSignalingLayer } from '@/lib/app-client';

import { nativeCryptoLayer, nativePeerSessionPlatformLayer } from './platform';

const peerSessionRuntime = Atom.runtime(
  Layer.mergeAll(
    peerSessionSignalingLayer,
    nativePeerSessionPlatformLayer,
    peerSessionEventSinkLayer,
    nativeCryptoLayer,
  ),
);

/**
 * Owns one scoped peer-session resource per session identity. Atom consumers
 * suspend during acquisition and release the actor and WebRTC resources when
 * the family member is no longer retained.
 */
export const peerSessionAtom = Atom.family((session: RoomSession) =>
  peerSessionRuntime.atom(startPeerSession(session)),
);

import type { RoomSession } from '@tether/client-runtime/modules/peer-session';
import {
  peerSessionEventSinkLayer,
  startPeerSession,
  type PeerSessionControllerBinding,
  type PreparedMedia,
} from '@tether/client-runtime/modules/room';
import { Effect, Layer } from 'effect';
import { Atom } from 'effect/unstable/reactivity';

import { peerSessionSignalingLayer } from '@/lib/app-client';

import { webCryptoLayer, webPeerSessionPlatformLayer } from './platform';

const peerSessionRuntime = Atom.runtime(
  Layer.mergeAll(
    peerSessionSignalingLayer,
    webPeerSessionPlatformLayer,
    peerSessionEventSinkLayer,
    webCryptoLayer,
  ),
);

/**
 * Owns one scoped peer-session resource per committed room owner. Atom
 * consumers suspend during acquisition and release the actor, controller
 * binding, and WebRTC resources when the family member is no longer retained.
 */
export const peerSessionAtom = Atom.family(
  ({
    session,
    preparedMedia,
    binding,
  }: {
    session: RoomSession;
    preparedMedia: PreparedMedia;
    binding: PeerSessionControllerBinding;
  }) =>
    peerSessionRuntime.atom(
      Effect.gen(function* () {
        const peerSession = yield* startPeerSession(session, preparedMedia);
        return yield* binding.activate(peerSession);
      }),
    ),
);

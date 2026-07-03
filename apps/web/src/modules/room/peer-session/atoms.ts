import { startPeerSession, type RoomSession } from '@tether/client-runtime/modules/room';
import { Crypto, Effect, Layer } from 'effect';
import { Atom } from 'effect/unstable/reactivity';

import { appClientLayer } from '@/lib/app-client';

import { webPeerSessionPlatformLayer } from './platform';
import { peerSessionEventSinkLayer } from './view';

const webCryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
    // Fresh copy: BufferSource rejects Uint8Array<ArrayBufferLike>.
    digest: (algorithm, data) =>
      Effect.promise(
        async () => new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(data))),
      ),
  }),
);

const peerSessionRuntime = Atom.runtime(
  Layer.mergeAll(
    appClientLayer,
    webPeerSessionPlatformLayer,
    peerSessionEventSinkLayer,
    webCryptoLayer,
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

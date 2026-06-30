import {
  PeerSessionEventSink,
  initialPeerSessionView,
  reducePeerSessionView,
  type PeerSessionEvent,
  type PeerSessionView,
} from '@tether/client-runtime/modules/room';
import { Effect, Layer } from 'effect';
import { Atom, AtomRegistry } from 'effect/unstable/reactivity';

/** Read model rendered by the room UI. */
export const peerSessionViewAtom = Atom.make<PeerSessionView>(initialPeerSessionView);

const emitPeerSessionEvent = (event: PeerSessionEvent) =>
  Atom.update(peerSessionViewAtom, (view) => reducePeerSessionView(view, event));

/**
 * Adapts actor output events into the registry used by the React-facing atom
 * runtime. Capturing the registry while constructing the layer lets actor code
 * emit an Effect event without depending on React or holding a React callback.
 */
export const peerSessionEventSinkLayer = Layer.effect(
  PeerSessionEventSink,
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;

    return PeerSessionEventSink.of({
      emit: (event) =>
        emitPeerSessionEvent(event).pipe(
          Effect.provideService(AtomRegistry.AtomRegistry, registry),
        ),
    });
  }),
);

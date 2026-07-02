import {
  PeerSessionEventSink,
  initialPeerSessionView,
  reducePeerSessionView,
  type PeerSessionEvent,
  type PeerSessionView,
} from '@tether/client-runtime/modules/room';
import { Effect, Layer } from 'effect';
import { Atom, AtomRegistry } from 'effect/unstable/reactivity';

// keepAlive: the sink writes these atoms before the suspended UI subscribes;
// without it those early writes (e.g. the offerer's instant Connected) are lost.
export const peerSessionViewAtom = Atom.make<PeerSessionView>(initialPeerSessionView).pipe(
  Atom.keepAlive,
);

/** Live local media, kept out of the serializable view; unwrapped to MediaStream here. */
export const peerLocalStreamAtom = Atom.make<MediaStream | null>(null).pipe(Atom.keepAlive);

const emitPeerSessionEvent = (event: PeerSessionEvent) =>
  event._tag === 'LocalStreamReady'
    ? Atom.update(peerLocalStreamAtom, () => event.stream.value as MediaStream)
    : Atom.update(peerSessionViewAtom, (view) => reducePeerSessionView(view, event));

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

import { Effect, Layer } from 'effect';
import { Atom, AtomRegistry } from 'effect/unstable/reactivity';

import type { ProgramStreamHandle, WatchEvent, WatchSessionView } from './Model';
import { WatchEventSink } from './Services';
import { initialWatchSessionView, reduceWatchView } from './View';

export const watchViewAtom = Atom.make<WatchSessionView>(initialWatchSessionView).pipe(
  Atom.keepAlive,
);

export const watchProgramStreamAtom = Atom.make<ProgramStreamHandle | null>(null).pipe(
  Atom.keepAlive,
);

const emitWatchEvent = (event: WatchEvent) => {
  switch (event._tag) {
    case 'WatchProgramStreamReady':
      return Atom.update(watchProgramStreamAtom, () => event.stream);
    case 'WatchProgramStreamCleared':
      return Atom.update(watchProgramStreamAtom, () => null);
    case 'WatchSessionChanged':
      return Atom.update(watchViewAtom, (view) => reduceWatchView(view, event));
    case 'WatchAvailabilityChanged':
    case 'WatchFailed':
      return Effect.void;
  }
};

export const watchEventSinkLayer = Layer.effect(
  WatchEventSink,
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    return WatchEventSink.of({
      emit: (event) =>
        emitWatchEvent(event).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry)),
    });
  }),
);

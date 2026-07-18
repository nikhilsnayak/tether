import { assert, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { AtomRegistry } from 'effect/unstable/reactivity';

import type { ProgramStreamHandle, WatchSessionView } from './Model';
import { WatchEventSink } from './Services';
import { initialWatchSessionView } from './View';
import { watchEventSinkLayer, watchProgramStreamAtom, watchViewAtom } from './WatchAtoms';

it.effect('projects watch views and program streams into keep-alive atoms', () =>
  Effect.gen(function* () {
    const registry = AtomRegistry.make();
    const layer = watchEventSinkLayer.pipe(
      Layer.provide(Layer.succeed(AtomRegistry.AtomRegistry, registry)),
    );
    const stream: ProgramStreamHandle = { value: { id: 'program' } };
    const view: WatchSessionView = {
      status: 'playing',
      role: 'watcher',
      progress: 0.5,
      revision: 2,
      controlsEnabled: true,
      canPresent: false,
      bufferingReason: null,
    };

    yield* Effect.gen(function* () {
      const sink = yield* WatchEventSink;
      yield* sink.emit({ _tag: 'WatchAvailabilityChanged', available: true });
      yield* sink.emit({ _tag: 'WatchSessionChanged', view });
      yield* sink.emit({ _tag: 'WatchProgramStreamReady', stream });
      yield* sink.emit({ _tag: 'WatchFailed', reason: 'pipeline' });
      assert.deepStrictEqual(registry.get(watchViewAtom), view);
      assert.strictEqual(registry.get(watchProgramStreamAtom), stream);

      yield* sink.emit({ _tag: 'WatchProgramStreamCleared' });
      yield* sink.emit({ _tag: 'WatchSessionChanged', view: initialWatchSessionView });
      assert.deepStrictEqual(registry.get(watchViewAtom), initialWatchSessionView);
      assert.isNull(registry.get(watchProgramStreamAtom));
    }).pipe(Effect.provide(layer));

    registry.dispose();
  }),
);

it.effect('isolates watch projections between registries', () =>
  Effect.gen(function* () {
    const first = AtomRegistry.make();
    const second = AtomRegistry.make();
    const firstLayer = watchEventSinkLayer.pipe(
      Layer.provide(Layer.succeed(AtomRegistry.AtomRegistry, first)),
    );
    const active: WatchSessionView = { ...initialWatchSessionView, status: 'idle' };

    yield* Effect.gen(function* () {
      const sink = yield* WatchEventSink;
      yield* sink.emit({ _tag: 'WatchSessionChanged', view: active });
    }).pipe(Effect.provide(firstLayer));

    assert.deepStrictEqual(first.get(watchViewAtom), active);
    assert.deepStrictEqual(second.get(watchViewAtom), initialWatchSessionView);
    first.dispose();
    second.dispose();
  }),
);

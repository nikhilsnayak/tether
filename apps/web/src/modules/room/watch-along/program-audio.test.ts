import { assert, describe, it } from '@effect/vitest';
import { Effect, Exit, Scope } from 'effect';

import {
  createProgramMonitor,
  PROGRAM_MONITOR_GRAPH,
  ProgramMonitorError,
  type ProgramMonitorEnvironment,
} from './program-audio';

class FakeNode {
  readonly connections: unknown[] = [];
  disconnectCount = 0;

  connect(destination: unknown) {
    this.connections.push(destination);
  }

  disconnect() {
    this.disconnectCount++;
  }
}

class FakeGain extends FakeNode {
  readonly gain = { value: -1 };
}

class FakeTrack {
  stopCount = 0;

  stop() {
    this.stopCount++;
  }
}

const makeMonitorHarness = () => {
  const source = new FakeNode();
  const gain = new FakeGain();
  const destination = new FakeNode() as FakeNode & { stream: MediaStream };
  const destinationTrack = new FakeTrack();
  destination.stream = {
    getTracks: () => [destinationTrack],
  } as unknown as MediaStream;
  const context = {
    state: 'suspended',
    destination: { name: 'context-destination' },
    createMediaElementSource: () => source,
    createGain: () => gain,
    createMediaStreamDestination: () => destination,
    resumeCount: 0,
    closeCount: 0,
    async resume() {
      this.resumeCount++;
      this.state = 'running';
    },
    async close() {
      this.closeCount++;
      this.state = 'closed';
    },
  };
  const sinkIds: string[] = [];
  const monitor = {
    autoplay: false,
    srcObject: null as MediaStream | null,
    playCount: 0,
    pauseCount: 0,
    async play() {
      this.playCount++;
    },
    pause() {
      this.pauseCount++;
    },
    async setSinkId(sinkId: string) {
      sinkIds.push(sinkId);
    },
  };
  const environment = {
    createAudioContext: () => context,
    createMonitorElement: () => monitor,
  } as unknown as ProgramMonitorEnvironment;
  return { source, gain, destination, destinationTrack, context, monitor, sinkIds, environment };
};

describe('program audio monitor', () => {
  it('defines a monitor-only graph with no outgoing capture gain', () => {
    assert.deepStrictEqual(PROGRAM_MONITOR_GRAPH, {
      connections: [
        ['media-element-source', 'monitor-gain'],
        ['monitor-gain', 'monitor-destination'],
      ],
      connectsToContextDestination: false,
      capturedAudioPassesThroughMonitorGain: false,
    });
  });

  it.effect('routes local monitoring through gain and selected sink', () => {
    const h = makeMonitorHarness();
    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      const monitor = yield* createProgramMonitor(
        {} as HTMLMediaElement,
        { volume: 0.4, sinkId: 'speaker-a', speakerEnabled: true },
        h.environment,
      ).pipe(Scope.provide(scope));

      assert.deepStrictEqual(h.source.connections, [h.gain]);
      assert.deepStrictEqual(h.gain.connections, [h.destination]);
      assert.notInclude(h.source.connections, h.context.destination);
      assert.strictEqual(h.gain.gain.value, 0.4);
      assert.deepStrictEqual(h.sinkIds, ['speaker-a']);
      assert.strictEqual(h.context.resumeCount, 1);
      assert.strictEqual(h.monitor.playCount, 1);

      yield* monitor.applyPreferences({ volume: 5, sinkId: 'default', speakerEnabled: false });
      assert.strictEqual(h.gain.gain.value, 0);
      assert.deepStrictEqual(h.sinkIds, ['speaker-a', '']);
      yield* Scope.close(scope, Exit.void);
      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(h.source.disconnectCount, 1);
      assert.strictEqual(h.destinationTrack.stopCount, 1);
      assert.strictEqual(h.monitor.pauseCount, 1);
      assert.isNull(h.monitor.srcObject);
      assert.strictEqual(h.context.closeCount, 1);
    });
  });

  it.effect('rejects a selected sink when output routing is unavailable', () => {
    const h = makeMonitorHarness();
    const withoutSink = { ...h.monitor, setSinkId: undefined };
    const environment = {
      ...h.environment,
      createMonitorElement: () => withoutSink,
    } as unknown as ProgramMonitorEnvironment;
    return Effect.gen(function* () {
      const error = yield* Effect.scoped(
        createProgramMonitor(
          {} as HTMLMediaElement,
          { volume: 1, sinkId: 'speaker-a', speakerEnabled: true },
          environment,
        ),
      ).pipe(Effect.flip);
      assert.instanceOf(error, ProgramMonitorError);
      assert.strictEqual(error.operation, 'set-sink');
    });
  });

  it.effect('allows default output without setSinkId and skips closed context work', () => {
    const h = makeMonitorHarness();
    h.context.state = 'running';
    const withoutSink = { ...h.monitor, setSinkId: undefined };
    const environment = {
      ...h.environment,
      createMonitorElement: () => withoutSink,
    } as unknown as ProgramMonitorEnvironment;
    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      yield* createProgramMonitor(
        {} as HTMLMediaElement,
        { volume: 1, sinkId: '', speakerEnabled: true },
        environment,
      ).pipe(Scope.provide(scope));
      assert.strictEqual(h.context.resumeCount, 0);
      h.context.state = 'closed';
      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(h.context.closeCount, 0);
    });
  });

  it.effect('recovers the preference queue after sink failures and still disposes', () => {
    const h = makeMonitorHarness();
    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      const monitor = yield* createProgramMonitor(
        {} as HTMLMediaElement,
        { volume: 1, sinkId: '', speakerEnabled: true },
        h.environment,
      ).pipe(Scope.provide(scope));
      h.monitor.setSinkId = async () => {
        throw new Error('sink');
      };

      const firstError = yield* monitor
        .applyPreferences({ volume: 0.5, sinkId: 'speaker-a', speakerEnabled: true })
        .pipe(Effect.flip);
      assert.strictEqual(firstError.operation, 'set-sink');

      h.monitor.setSinkId = async (sinkId: string) => {
        h.sinkIds.push(sinkId);
      };
      yield* monitor.applyPreferences({ volume: 0.25, sinkId: 'speaker-b', speakerEnabled: true });
      assert.strictEqual(h.gain.gain.value, 0.25);

      h.monitor.setSinkId = async () => {
        throw new Error('sink');
      };
      yield* monitor
        .applyPreferences({ volume: 0.75, sinkId: 'speaker-c', speakerEnabled: true })
        .pipe(Effect.flip);
      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(h.context.closeCount, 1);
    });
  });

  it.effect('maps construction and playback failures', () =>
    Effect.gen(function* () {
      const createError = yield* Effect.scoped(
        createProgramMonitor(
          {} as HTMLMediaElement,
          { volume: 1, sinkId: '', speakerEnabled: true },
          {
            createAudioContext: () => {
              throw new Error('context');
            },
            createMonitorElement: () => {
              throw new Error('unused');
            },
          },
        ),
      ).pipe(Effect.flip);
      assert.strictEqual(createError.operation, 'create');

      const h = makeMonitorHarness();
      h.monitor.play = async () => {
        throw new Error('autoplay');
      };
      const playError = yield* Effect.scoped(
        createProgramMonitor(
          {} as HTMLMediaElement,
          { volume: 1, sinkId: '', speakerEnabled: true },
          h.environment,
        ),
      ).pipe(Effect.flip);
      assert.strictEqual(playError.operation, 'play');
      assert.strictEqual(h.context.closeCount, 1);
    }),
  );
});

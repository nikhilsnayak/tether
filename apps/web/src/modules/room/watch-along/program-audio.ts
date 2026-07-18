import { Data, Effect, Semaphore } from 'effect';

import { normalizeProgramVolume, type ProgramAudioPreferences } from './program-audio-preferences';

export const PROGRAM_MONITOR_GRAPH = {
  connections: [
    ['media-element-source', 'monitor-gain'],
    ['monitor-gain', 'monitor-destination'],
  ],
  connectsToContextDestination: false,
  capturedAudioPassesThroughMonitorGain: false,
} as const;

export class ProgramMonitorError extends Data.TaggedError('ProgramMonitorError')<{
  readonly operation: 'create' | 'play' | 'set-sink';
  readonly cause: unknown;
}> {}

interface AudioNodeLike {
  readonly connect: (destination: unknown) => unknown;
  readonly disconnect: () => void;
}

interface GainNodeLike extends AudioNodeLike {
  readonly gain: { value: number };
}

interface MediaStreamDestinationLike extends AudioNodeLike {
  readonly stream: MediaStream;
}

interface AudioContextLike {
  readonly state: string;
  readonly destination: unknown;
  readonly createMediaElementSource: (element: HTMLMediaElement) => AudioNodeLike;
  readonly createGain: () => GainNodeLike;
  readonly createMediaStreamDestination: () => MediaStreamDestinationLike;
  readonly resume: () => Promise<void>;
  readonly close: () => Promise<void>;
}

interface MonitorElementLike {
  autoplay: boolean;
  srcObject: MediaStream | null;
  readonly play: () => Promise<void>;
  readonly pause: () => void;
  readonly setSinkId?: (sinkId: string) => Promise<void>;
}

export interface ProgramMonitorEnvironment {
  readonly createAudioContext: () => AudioContextLike;
  readonly createMonitorElement: () => MonitorElementLike;
}

export interface ProgramMonitor {
  readonly applyPreferences: (
    preferences: ProgramAudioPreferences,
  ) => Effect.Effect<void, ProgramMonitorError>;
}

const browserProgramMonitorEnvironment: ProgramMonitorEnvironment = {
  createAudioContext: () => new AudioContext() as unknown as AudioContextLike,
  createMonitorElement: () => document.createElement('audio') as unknown as MonitorElementLike,
};

const normalizeSinkId = (sinkId: string): string => (sinkId === 'default' ? '' : sinkId);

export const createProgramMonitor = Effect.fn('createProgramMonitor')(function* (
  sourceElement: HTMLMediaElement,
  initialPreferences: ProgramAudioPreferences,
  environment: ProgramMonitorEnvironment = browserProgramMonitorEnvironment,
) {
  const preferenceLock = yield* Semaphore.make(1);
  const resources = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const context = environment.createAudioContext();
        const source = context.createMediaElementSource(sourceElement);
        const gain = context.createGain();
        const destination = context.createMediaStreamDestination();
        const monitor = environment.createMonitorElement();
        source.connect(gain);
        gain.connect(destination);
        monitor.autoplay = true;
        monitor.srcObject = destination.stream;
        return { context, source, gain, destination, monitor };
      },
      catch: (cause) => new ProgramMonitorError({ operation: 'create', cause }),
    }),
    (resources) =>
      preferenceLock.withPermit(
        Effect.tryPromise(async () => {
          resources.source.disconnect();
          resources.gain.disconnect();
          resources.destination.disconnect();
          for (const track of resources.destination.stream.getTracks()) track.stop();
          resources.monitor.pause();
          resources.monitor.srcObject = null;
          if (resources.context.state !== 'closed') await resources.context.close();
        }).pipe(Effect.ignore),
      ),
  );

  const applyPreferences = (preferences: ProgramAudioPreferences) =>
    preferenceLock.withPermit(
      Effect.tryPromise({
        try: async () => {
          resources.gain.gain.value = preferences.speakerEnabled
            ? normalizeProgramVolume(preferences.volume)
            : 0;
          const sinkId = normalizeSinkId(preferences.sinkId);
          if (resources.monitor.setSinkId !== undefined) {
            await resources.monitor.setSinkId(sinkId);
          } else if (sinkId !== '') {
            throw new Error('Selected audio output is unsupported');
          }
        },
        catch: (cause) => new ProgramMonitorError({ operation: 'set-sink', cause }),
      }),
    );

  yield* applyPreferences(initialPreferences);
  yield* Effect.tryPromise({
    try: async () => {
      if (resources.context.state === 'suspended') await resources.context.resume();
      await resources.monitor.play();
    },
    catch: (cause) => new ProgramMonitorError({ operation: 'play', cause }),
  });

  return { applyPreferences } satisfies ProgramMonitor;
});

import type { ProgramStreamHandle } from '@tether/client-runtime/modules/watch-along';
import { Effect } from 'effect';

import type { ProgramMonitor } from '../program-audio';
import {
  createProgramAudioPreferencesStore,
  type ProgramAudioPreferences,
} from '../program-audio-preferences';
import {
  prepareWatchSourceWith,
  webWatchSourceResource,
  type CapturableVideoElement,
  type PreparedWebWatchSource,
  type WatchSourceEnvironment,
} from '../source-adapter';

export class FakeWatchTrack {
  contentHint = '';
  stopCount = 0;
  readonly kind: 'audio' | 'video';

  constructor(kind: 'audio' | 'video') {
    this.kind = kind;
  }

  stop() {
    this.stopCount++;
  }
}

export class FakeWatchStream {
  readonly videoTrack: FakeWatchTrack | undefined;
  readonly audioTrack: FakeWatchTrack | undefined;

  constructor(options: { readonly video?: boolean; readonly audio?: boolean } = {}) {
    this.videoTrack = options.video === false ? undefined : new FakeWatchTrack('video');
    this.audioTrack = options.audio === false ? undefined : new FakeWatchTrack('audio');
  }

  getTracks() {
    return [this.videoTrack, this.audioTrack].filter(
      (track): track is FakeWatchTrack => track !== undefined,
    );
  }

  getVideoTracks() {
    return this.videoTrack === undefined ? [] : [this.videoTrack];
  }

  getAudioTracks() {
    return this.audioTrack === undefined ? [] : [this.audioTrack];
  }
}

export class FakeWatchVideo {
  readonly listeners = new Map<string, Set<() => void>>();
  preload = '';
  playsInline = false;
  muted = true;
  volume = 0;
  src = '';
  readyState = 3;
  duration = 100;
  paused = true;
  ended = false;
  error: MediaError | null = null;
  playCount = 0;
  pauseCount = 0;
  loadCount = 0;
  captureCount = 0;
  removeSourceCount = 0;
  currentTimeWriteCount = 0;
  canPlay = 'probably';
  playFailure: unknown = null;
  captureFailure: unknown = null;
  private time = 0;
  readonly stream: FakeWatchStream;

  constructor(stream = new FakeWatchStream()) {
    this.stream = stream;
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(value: number) {
    this.currentTimeWriteCount++;
    this.time = value;
  }

  canPlayType() {
    return this.canPlay;
  }

  captureStream() {
    this.captureCount++;
    if (this.captureFailure !== null) throw this.captureFailure;
    return this.stream as unknown as MediaStream;
  }

  async play() {
    this.playCount++;
    if (this.playFailure !== null) throw this.playFailure;
    this.paused = false;
  }

  pause() {
    this.pauseCount++;
    this.paused = true;
  }

  load() {
    this.loadCount++;
  }

  removeAttribute(name: string) {
    if (name === 'src') {
      this.src = '';
      this.removeSourceCount++;
    }
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

export class FakeVisibilityDocument {
  hidden = false;
  readonly listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.delete(listener);
  }

  emit(hidden: boolean) {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
}

export class FakeProgramMonitor implements ProgramMonitor {
  readonly applied: ProgramAudioPreferences[] = [];
  disposeCount = 0;
  applyFailure = false;

  readonly applyPreferences = (preferences: ProgramAudioPreferences) => {
    this.applied.push(preferences);
    return this.applyFailure ? Effect.fail({ reason: 'sink' } as never) : Effect.void;
  };
}

export interface WatchSourceTestFixture {
  readonly prepared: PreparedWebWatchSource;
  readonly video: FakeWatchVideo;
  readonly stream: FakeWatchStream;
  readonly monitor: FakeProgramMonitor;
  readonly visibility: FakeVisibilityDocument;
  readonly revoked: string[];
  readonly preferences: ReturnType<typeof createProgramAudioPreferencesStore>;
  readonly expectedStream: ProgramStreamHandle;
}

export const makeWatchSourceTestFixture = Effect.fn('makeWatchSourceTestFixture')(function* (
  options: {
    readonly video?: FakeWatchVideo;
    readonly monitor?: FakeProgramMonitor;
    readonly environment?: Partial<WatchSourceEnvironment>;
  } = {},
) {
  const video = options.video ?? new FakeWatchVideo();
  const monitor = options.monitor ?? new FakeProgramMonitor();
  const visibility = new FakeVisibilityDocument();
  const revoked: string[] = [];
  const preferences = createProgramAudioPreferencesStore();
  const environment: WatchSourceEnvironment = {
    createObjectURL: () => 'blob:watch-source',
    revokeObjectURL: (url) => void revoked.push(url),
    createVideoElement: () => video as unknown as CapturableVideoElement,
    createMonitor: (() =>
      Effect.acquireRelease(Effect.succeed(monitor), () =>
        Effect.sync(() => {
          monitor.disposeCount++;
        }),
      )) as WatchSourceEnvironment['createMonitor'],
    visibility,
    ...options.environment,
  };
  const prepared = yield* prepareWatchSourceWith(
    { type: 'video/mp4' } as File,
    environment,
    preferences,
  );
  const resource = webWatchSourceResource(prepared.source);
  if (resource === null) return yield* Effect.die('missing web source resource');
  return {
    prepared,
    video,
    stream: video.stream,
    monitor,
    visibility,
    revoked,
    preferences,
    expectedStream: { value: resource.stream },
  } satisfies WatchSourceTestFixture;
});

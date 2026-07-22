import type { ProgramStreamHandle } from '@tether/client-runtime/modules/watch-along';
import { Effect } from 'effect';

import {
  prepareWatchSourceWith,
  webWatchSourceResource,
  type CapturableVideoElement,
} from '../source-adapter';

export class FakeWatchTrack {
  readonly kind: 'audio' | 'video';
  contentHint = '';
  stopCount = 0;

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
  readonly stream: FakeWatchStream;
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
  captureCount = 0;
  removeSourceCount = 0;
  currentTimeWriteCount = 0;
  canPlay = 'probably';
  playFailure: unknown = null;
  captureFailure: unknown = null;
  private time = 0;

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

  load() {}

  removeAttribute(name: string) {
    if (name !== 'src') return;
    this.src = '';
    this.removeSourceCount++;
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

export const makeWatchSourceTestFixture = Effect.fn('makeWatchSourceTestFixture')(function* (
  video = new FakeWatchVideo(),
) {
  const revoked: string[] = [];
  const prepared = yield* prepareWatchSourceWith({ type: 'video/mp4' } as File, {
    createObjectURL: () => 'blob:watch-source',
    revokeObjectURL: (url) => void revoked.push(url),
    createVideoElement: () => video as unknown as CapturableVideoElement,
  });
  const resource = webWatchSourceResource(prepared.source);
  if (resource === null) return yield* Effect.die('missing web source resource');
  return {
    prepared,
    video,
    stream: video.stream,
    revoked,
    expectedStream: { value: resource.stream } satisfies ProgramStreamHandle,
  };
});

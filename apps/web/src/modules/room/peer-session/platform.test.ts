import { assert, describe, it } from '@effect/vitest';
import {
  PeerSessionPlatform,
  PlatformError,
  type DataChannelHandle,
  type IceCandidate,
  type IceServer,
  type PeerConnectionHandle,
  ROOM_EVENTS_CHANNEL_LABEL,
  type SessionDescription,
} from '@tether/client-runtime/modules/peer-session';
import {
  describePeerSessionPlatformContract,
  type PeerSessionPlatformTestHarness,
} from '@tether/test-support/peer-session-platform-contract';
import { Crypto, Effect, Exit, Scope } from 'effect';
import { afterEach, vi } from 'vitest';

import {
  mediaStreamValue,
  prepareLocalMedia,
  webCryptoLayer,
  webPeerSessionPlatformLayer,
} from './platform';

class FakeTrack {
  readonly stop = vi.fn();
}

class FakeMediaStream {
  readonly track = new FakeTrack();
  readonly getTracks = vi.fn(() => [this.track]);
}

class FakeDataChannel {
  readonly listeners = new Map<string, Set<(event: never) => void>>();
  readonly send = vi.fn();
  readonly close = vi.fn(() => {
    this.readyState = 'closed';
  });
  readyState = 'connecting';
  bufferedAmount = 0;
  readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  addEventListener(name: string, listener: (event: never) => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: (event: never) => void) {
    this.listeners.get(name)?.delete(listener);
  }

  emit(name: string, event: unknown = {}) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(event as never);
    }
  }
}

class FakePeerConnection {
  readonly listeners = new Map<string, Set<(event: never) => void>>();
  readonly addTrack = vi.fn((_track: unknown, _stream: unknown) => undefined);
  readonly close = vi.fn();
  readonly createOffer = vi.fn(async () => ({ sdp: 'offer-sdp' }));
  readonly createAnswer = vi.fn(async () => ({ sdp: 'answer-sdp' }));
  readonly setLocalDescription = vi.fn(async (_description: unknown) => undefined);
  readonly setRemoteDescription = vi.fn(async (_description: unknown) => undefined);
  readonly addIceCandidate = vi.fn(async (_candidate: unknown) => undefined);
  connectionState = 'new';
  iceGatheringState = 'new';
  readonly configuration: { readonly iceServers: ReadonlyArray<IceServer> };

  constructor(configuration: { readonly iceServers: ReadonlyArray<IceServer> }) {
    this.configuration = configuration;
  }

  createDataChannel(label: string) {
    return new FakeDataChannel(label);
  }

  addEventListener(name: string, listener: (event: never) => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: (event: never) => void) {
    this.listeners.get(name)?.delete(listener);
  }

  emit(name: string, event: unknown = {}) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(event as never);
    }
  }
}

interface WebPlatformTestHarness extends PeerSessionPlatformTestHarness {
  readonly mediaStream: FakeMediaStream;
  readonly getUserMedia: ReturnType<typeof vi.fn>;
}

const makeWebPlatformTestHarness = (): WebPlatformTestHarness => {
  const mediaStream = new FakeMediaStream();
  const getUserMedia = vi.fn(async (_constraints: unknown) => mediaStream);
  const getRandomValues = vi.fn((array: Uint8Array) => {
    array.fill(7);
    return array;
  });
  const digest = vi.fn(async (_algorithm: string, data: Uint8Array) => data);

  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('crypto', { getRandomValues, subtle: { digest } });

  const peer = (handle: PeerConnectionHandle) => handle.value as FakePeerConnection;
  const channel = (handle: DataChannelHandle) => handle.value as FakeDataChannel;

  return {
    layer: webPeerSessionPlatformLayer,
    localMedia: { value: mediaStream },
    mediaStream,
    getUserMedia,
    controls: {
      failLocalMediaAcquisition: () => {
        getUserMedia.mockRejectedValueOnce(new Error('permission denied'));
      },
      failPeerConnectionAcquisition: () => {
        vi.stubGlobal(
          'RTCPeerConnection',
          class {
            constructor() {
              throw new Error('construction failed');
            }
          },
        );
      },
      emitIceCandidate: (handle, candidate) => peer(handle).emit('icecandidate', { candidate }),
      emitRemoteDataChannel: (handle, label) =>
        peer(handle).emit('datachannel', { channel: new FakeDataChannel(label) }),
      emitRemoteTrack: (handle, stream) =>
        peer(handle).emit('track', { streams: stream === null ? [] : [stream.value] }),
      transitionConnection: (handle, state) => {
        peer(handle).connectionState = state;
        peer(handle).emit('connectionstatechange');
      },
      transitionIceGathering: (handle, state) => {
        peer(handle).iceGatheringState = state;
        peer(handle).emit('icegatheringstatechange');
      },
      setDataChannelState: (handle, state) => {
        channel(handle).readyState = state;
      },
      emitDataChannelOpen: (handle) => channel(handle).emit('open'),
      emitDataChannelMessage: (handle, data) => channel(handle).emit('message', { data }),
      emitDataChannelClose: (handle) => channel(handle).emit('close'),
    },
    observations: {
      iceServers: (handle) => peer(handle).configuration.iceServers,
      addedTrackCount: (handle) => peer(handle).addTrack.mock.calls.length,
      localDescriptions: (handle) =>
        peer(handle).setLocalDescription.mock.calls.map(
          ([description]) => description as Required<SessionDescription>,
        ),
      remoteDescriptions: (handle) =>
        peer(handle).setRemoteDescription.mock.calls.map(
          ([description]) => description as Required<SessionDescription>,
        ),
      iceCandidates: (handle) =>
        peer(handle).addIceCandidate.mock.calls.map(([value]) => {
          const ice = value as IceCandidate;
          return {
            candidate: ice.candidate,
            sdpMid: ice.sdpMid,
            sdpMLineIndex: ice.sdpMLineIndex,
          };
        }),
      sentMessages: (handle) => channel(handle).send.mock.calls.map(([message]) => String(message)),
      peerConnectionCloseCount: (handle) => peer(handle).close.mock.calls.length,
      peerConnectionListenerCount: (handle) =>
        [...peer(handle).listeners.values()].reduce(
          (count, listeners) => count + listeners.size,
          0,
        ),
      dataChannelListenerCount: (handle) =>
        [...channel(handle).listeners.values()].reduce(
          (count, listeners) => count + listeners.size,
          0,
        ),
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describePeerSessionPlatformContract('web', makeWebPlatformTestHarness);

describe('web peer-session platform', () => {
  it.effect('provides browser cryptography', () => {
    makeWebPlatformTestHarness();
    return Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      assert.deepStrictEqual(yield* crypto.randomBytes(3), new Uint8Array([7, 7, 7]));
      assert.deepStrictEqual(
        yield* crypto.digest('SHA-256', new Uint8Array([1, 2, 3])),
        new Uint8Array([1, 2, 3]),
      );
    }).pipe(Effect.provide(webCryptoLayer));
  });

  it.effect('acquires and releases browser local media', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const handle = yield* platform.acquireLocalMedia;
        assert.strictEqual(
          mediaStreamValue(handle),
          harness.mediaStream as unknown as ReturnType<typeof mediaStreamValue>,
        );
        assert.deepStrictEqual(harness.getUserMedia.mock.calls[0]?.[0], {
          video: true,
          audio: true,
        });
      }).pipe(Effect.provide(harness.layer)),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          assert.strictEqual(harness.mediaStream.track.stop.mock.calls.length, 1);
        }),
      ),
    );
  });

  it.effect('cancels prepared local media exactly once before transfer', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.gen(function* () {
      const prepared = yield* prepareLocalMedia();
      yield* Effect.promise(prepared.cancel);
      yield* Effect.promise(prepared.cancel);
      assert.strictEqual(harness.mediaStream.track.stop.mock.calls.length, 1);
    });
  });

  it.effect('transfers the exact prepared stream into a session scope', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.gen(function* () {
      const prepared = yield* prepareLocalMedia();
      const transferred = prepared.transfer();
      assert.throws(() => prepared.transfer(), 'Prepared local media can only be transferred once');

      const scope = yield* Scope.make();
      const handle = yield* transferred.claim.pipe(Scope.provide(scope));
      assert.strictEqual(mediaStreamValue(handle), harness.mediaStream as unknown as MediaStream);
      const secondClaimError = yield* transferred.claim.pipe(Scope.provide(scope), Effect.flip);
      assert.instanceOf(secondClaimError, PlatformError);

      yield* Effect.promise(prepared.cancel);
      assert.strictEqual(harness.mediaStream.track.stop.mock.calls.length, 0);
      yield* Scope.close(scope, Exit.void);
      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(harness.mediaStream.track.stop.mock.calls.length, 1);
    });
  });

  it.effect('releases transferred media that is abandoned without claim', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.gen(function* () {
      const prepared = yield* prepareLocalMedia();
      prepared.transfer();
      yield* Effect.promise(prepared.cancel);
      assert.strictEqual(harness.mediaStream.track.stop.mock.calls.length, 1);
    });
  });

  it.effect('closes its empty scope when prepared acquisition fails', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.gen(function* () {
      harness.getUserMedia.mockRejectedValueOnce(new Error('permission denied'));
      const error = yield* prepareLocalMedia().pipe(Effect.flip);
      assert.instanceOf(error, PlatformError);
      assert.strictEqual(error.operation, 'acquire-local-media');
    });
  });

  it.effect('exposes browser backpressure and immediate channel cleanup', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const dataChannel = yield* platform.createDataChannel(
          peerConnection,
          ROOM_EVENTS_CHANNEL_LABEL,
        );
        const channel = dataChannel.value as FakeDataChannel;
        channel.bufferedAmount = 65_536;

        assert.strictEqual(platform.dataChannelBufferedAmount?.(dataChannel), 65_536);
        assert.isDefined(platform.closeDataChannel);
        if (platform.closeDataChannel === undefined) return;
        yield* platform.closeDataChannel(dataChannel);
        assert.strictEqual(channel.close.mock.calls.length, 1);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it.effect('maps browser channel-close failures to PlatformError', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.gen(function* () {
      const platform = yield* PeerSessionPlatform;
      assert.isDefined(platform.closeDataChannel);
      if (platform.closeDataChannel === undefined) return;
      const error = yield* platform.closeDataChannel({ value: {} }).pipe(Effect.flip);
      assert.instanceOf(error, PlatformError);
      assert.strictEqual(error.operation, 'close-data-channel');
    }).pipe(Effect.provide(harness.layer));
  });
});

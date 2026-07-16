import { assert, describe, it } from '@effect/vitest';
import {
  PeerSessionPlatform,
  type DataChannelHandle,
  type IceCandidate,
  type IceServer,
  type PeerConnectionHandle,
  type PlatformEvent,
  type SessionDescription,
} from '@tether/client-runtime/modules/peer-session';
import {
  describePeerSessionPlatformContract,
  type PeerSessionPlatformTestHarness,
} from '@tether/test-support/peer-session-platform-contract';
import { Crypto, Effect } from 'effect';
import { afterEach, vi } from 'vitest';

const native = vi.hoisted(() => {
  class FakeTrack {
    readonly stop = vi.fn();
  }

  class FakeMediaStream {
    readonly track = new FakeTrack();
    readonly getTracks = vi.fn(() => [this.track]);
    readonly release = vi.fn();
  }

  class FakeDataChannel {
    readonly listeners = new Map<string, Set<(event: never) => void>>();
    readonly send = vi.fn();
    readyState = 'connecting';
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
    static failNext = false;
    readonly listeners = new Map<string, Set<(event: never) => void>>();
    readonly addTrack = vi.fn((_track: unknown, _stream: unknown) => undefined);
    readonly close = vi.fn();
    readonly createOffer = vi.fn(async (_options?: unknown) => ({ sdp: 'offer-sdp' }));
    readonly createAnswer = vi.fn(async () => ({ sdp: 'answer-sdp' }));
    readonly setLocalDescription = vi.fn(async (_description: unknown) => undefined);
    readonly setRemoteDescription = vi.fn(async (_description: unknown) => undefined);
    readonly addIceCandidate = vi.fn(async (_candidate: unknown) => undefined);
    connectionState = 'new';
    iceGatheringState = 'new';
    readonly configuration: { readonly iceServers: ReadonlyArray<IceServer> };

    constructor(configuration: { readonly iceServers: ReadonlyArray<IceServer> }) {
      this.configuration = configuration;
      if (FakePeerConnection.failNext) {
        FakePeerConnection.failNext = false;
        throw new Error('peer connection unavailable');
      }
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

  return {
    FakeDataChannel,
    FakeMediaStream,
    FakePeerConnection,
    getUserMedia: vi.fn(),
    getRandomBytes: vi.fn((size: number) => new Uint8Array(size).fill(7)),
    digest: vi.fn(async (_algorithm: string, data: Uint8Array) => data),
  };
});

vi.mock('react-native-webrtc', () => ({
  MediaStream: native.FakeMediaStream,
  RTCPeerConnection: native.FakePeerConnection,
  mediaDevices: { getUserMedia: native.getUserMedia },
}));

vi.mock('expo-crypto', () => ({
  getRandomBytes: native.getRandomBytes,
  digest: native.digest,
}));

import { mediaStreamValue, nativeCryptoLayer, nativePeerSessionPlatformLayer } from './platform';

interface NativePlatformTestHarness extends PeerSessionPlatformTestHarness {
  readonly mediaStream: InstanceType<typeof native.FakeMediaStream>;
}

const makeNativePlatformTestHarness = (): NativePlatformTestHarness => {
  const mediaStream = new native.FakeMediaStream();
  native.FakePeerConnection.failNext = false;
  native.getUserMedia.mockImplementation(async (_constraints: unknown) => mediaStream);

  const peer = (handle: PeerConnectionHandle) =>
    handle.value as InstanceType<typeof native.FakePeerConnection>;
  const channel = (handle: DataChannelHandle) =>
    handle.value as InstanceType<typeof native.FakeDataChannel>;

  return {
    layer: nativePeerSessionPlatformLayer,
    localMedia: { value: mediaStream },
    mediaStream,
    controls: {
      failLocalMediaAcquisition: () => {
        native.getUserMedia.mockRejectedValueOnce(new Error('permission denied'));
      },
      failPeerConnectionAcquisition: () => {
        native.FakePeerConnection.failNext = true;
      },
      emitIceCandidate: (handle, candidate) => peer(handle).emit('icecandidate', { candidate }),
      emitRemoteDataChannel: (handle, label) =>
        peer(handle).emit('datachannel', { channel: new native.FakeDataChannel(label) }),
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
  native.FakePeerConnection.failNext = false;
  vi.clearAllMocks();
});

describePeerSessionPlatformContract('native', makeNativePlatformTestHarness);

describe('native peer-session platform', () => {
  it.effect('provides native cryptography', () => {
    makeNativePlatformTestHarness();
    return Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      assert.deepStrictEqual(yield* crypto.randomBytes(3), new Uint8Array([7, 7, 7]));
      assert.deepStrictEqual(
        yield* crypto.digest('SHA-256', new Uint8Array([1, 2, 3])),
        new Uint8Array([1, 2, 3]),
      );
    }).pipe(Effect.provide(nativeCryptoLayer));
  });

  it.effect('acquires and releases native local media', () => {
    const harness = makeNativePlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const handle = yield* platform.acquireLocalMedia;
        assert.strictEqual(
          mediaStreamValue(handle),
          harness.mediaStream as unknown as ReturnType<typeof mediaStreamValue>,
        );
        assert.deepStrictEqual(native.getUserMedia.mock.calls[0]?.[0], {
          video: { facingMode: 'user' },
          audio: true,
        });
      }).pipe(Effect.provide(harness.layer)),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          assert.strictEqual(harness.mediaStream.track.stop.mock.calls.length, 1);
          assert.strictEqual(harness.mediaStream.release.mock.calls.length, 1);
        }),
      ),
    );
  });

  it.effect('normalizes missing native ICE metadata to null', () => {
    const harness = makeNativePlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const events: PlatformEvent[] = [];
        yield* platform.observePeerConnection(peerConnection, (event) => events.push(event));

        const peer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
        peer.emit('icecandidate', { candidate: { candidate: 'candidate' } });

        assert.deepStrictEqual(events, [
          {
            _tag: 'LocalIceCandidate',
            peerConnection,
            candidate: {
              candidate: 'candidate',
              sdpMid: null,
              sdpMLineIndex: null,
              usernameFragment: null,
            },
          },
        ]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });
});

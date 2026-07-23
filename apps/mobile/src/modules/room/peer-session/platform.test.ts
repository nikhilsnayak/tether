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
    constructor(readonly kind = 'video') {}
  }

  class FakeMediaStream {
    readonly track = new FakeTrack();
    readonly videoTrack = new FakeTrack();
    readonly audioTrack = new FakeTrack();
    readonly getTracks = vi.fn(() => [this.track]);
    readonly getVideoTracks = vi.fn(() => [this.videoTrack]);
    readonly getAudioTracks = vi.fn(() => [this.audioTrack]);
    readonly addTrack = vi.fn();
    readonly release = vi.fn();
    constructor(_tracks?: ReadonlyArray<unknown>) {}
  }

  class FakeDataChannel {
    readonly listeners = new Map<string, Set<(event: never) => void>>();
    readonly send = vi.fn();
    readonly close = vi.fn();
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
    readonly transceivers: Array<{
      readonly sender: { readonly replaceTrack: ReturnType<typeof vi.fn> };
      readonly receiver: { readonly track: FakeTrack | null };
    }> = [];
    readonly addTransceiver = vi.fn((kind: string, _init: unknown) => {
      const transceiver = {
        sender: { replaceTrack: vi.fn(async (_track: unknown) => undefined) },
        receiver: { track: new FakeTrack(kind) },
      };
      this.transceivers.push(transceiver);
      return transceiver;
    });
    readonly getTransceivers = vi.fn(() => this.transceivers);
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
    FakeTrack,
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
  it.effect('closes native data channels and maps close failures', () => {
    const harness = makeNativePlatformTestHarness();
    return Effect.gen(function* () {
      const platform = yield* PeerSessionPlatform;
      const peerConnection = yield* platform.acquirePeerConnection([]);
      const dataChannel = yield* platform.createDataChannel(peerConnection, 'watch-control-v1');
      const channel = dataChannel.value as InstanceType<typeof native.FakeDataChannel>;

      assert.isDefined(platform.closeDataChannel);
      if (platform.closeDataChannel === undefined) return;
      yield* platform.closeDataChannel(dataChannel);
      assert.strictEqual(channel.close.mock.calls.length, 1);

      const error = yield* platform.closeDataChannel({ value: {} }).pipe(Effect.flip);
      assert.strictEqual(error.operation, 'close-data-channel');
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

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

  it.effect('reserves and replaces native watch-along tracks', () => {
    const harness = makeNativePlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const transceiver = yield* platform.reserveProgramTransceivers(peerConnection, 'offerer');

        yield* platform.activateProgramTransceivers(transceiver);
        yield* platform.replaceProgramTracks(transceiver, harness.localMedia);
        yield* platform.replaceProgramTracks(transceiver, null);

        const peer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
        // First-release mobile is receive-only: it never presents program media.
        assert.deepStrictEqual(peer.addTransceiver.mock.calls, [
          ['video', { direction: 'recvonly' }],
          ['audio', { direction: 'recvonly' }],
        ]);
        const reserved = transceiver.value as {
          readonly video: { readonly sender: { readonly replaceTrack: ReturnType<typeof vi.fn> } };
          readonly audio: { readonly sender: { readonly replaceTrack: ReturnType<typeof vi.fn> } };
        };
        assert.deepStrictEqual(reserved.video.sender.replaceTrack.mock.calls, [
          [harness.mediaStream.videoTrack],
          [null],
        ]);
        assert.deepStrictEqual(reserved.audio.sender.replaceTrack.mock.calls, [
          [harness.mediaStream.audioTrack],
          [null],
        ]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it.effect('adopts native program transceivers created from the remote offer', () => {
    const harness = makeNativePlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const reservation = yield* platform.reserveProgramTransceivers(peerConnection, 'answerer');
        const peer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
        const video = {
          sender: { replaceTrack: vi.fn(async (_track: unknown) => undefined) },
          receiver: { track: new native.FakeTrack('video') },
        };
        const audio = {
          sender: { replaceTrack: vi.fn(async (_track: unknown) => undefined) },
          receiver: { track: new native.FakeTrack('audio') },
        };

        yield* platform.setRemoteDescription(peerConnection, { type: 'offer', sdp: 'offer-sdp' });
        peer.transceivers.push(video, audio);
        yield* platform.activateProgramTransceivers(reservation);
        yield* platform.replaceProgramTracks(reservation, harness.localMedia);

        assert.strictEqual(peer.addTransceiver.mock.calls.length, 0);
        assert.deepStrictEqual(video.sender.replaceTrack.mock.calls, [
          [harness.mediaStream.videoTrack],
        ]);
        assert.deepStrictEqual(audio.sender.replaceTrack.mock.calls, [
          [harness.mediaStream.audioTrack],
        ]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it.effect('groups streamless native program tracks into one media stream', () => {
    const harness = makeNativePlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const events: Array<{
          readonly _tag: string;
          readonly stream?: { readonly value: unknown };
        }> = [];
        yield* platform.observePeerConnection(peerConnection, (event) => events.push(event));

        const peer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
        peer.emit('track', { streams: [], track: null });
        peer.emit('track', { streams: [], track: new native.FakeTrack() });
        peer.emit('track', { streams: [], track: new native.FakeTrack() });

        assert.deepStrictEqual(
          events.map((event) => event._tag),
          ['RemoteSharedTrackReceived', 'RemoteSharedTrackReceived'],
        );
        assert.strictEqual(events[0]?.stream?.value, events[1]?.stream?.value);
        const stream = events[0]?.stream?.value as {
          readonly addTrack: ReturnType<typeof vi.fn>;
        };
        assert.strictEqual(stream.addTrack.mock.calls.length, 1);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it.effect('maps native program transceiver failures', () => {
    const reserveHarness = makeNativePlatformTestHarness();
    const reserve = Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const peer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
        peer.addTransceiver.mockImplementationOnce(() => {
          throw new Error('reserve');
        });

        const error = yield* platform
          .reserveProgramTransceivers(peerConnection, 'offerer')
          .pipe(Effect.flip);
        assert.strictEqual(error.operation, 'reserve-program-transceivers');
      }).pipe(Effect.provide(reserveHarness.layer)),
    );

    const answererReserveHarness = makeNativePlatformTestHarness();
    const answererReserve = Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const peer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
        peer.getTransceivers.mockImplementationOnce(() => {
          throw new Error('reserve');
        });

        const error = yield* platform
          .reserveProgramTransceivers(peerConnection, 'answerer')
          .pipe(Effect.flip);
        assert.strictEqual(error.operation, 'reserve-program-transceivers');
      }).pipe(Effect.provide(answererReserveHarness.layer)),
    );

    const replaceHarness = makeNativePlatformTestHarness();
    const replace = Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const transceiver = yield* platform.reserveProgramTransceivers(peerConnection, 'offerer');
        const reserved = transceiver.value as {
          readonly video: { readonly sender: { readonly replaceTrack: ReturnType<typeof vi.fn> } };
        };
        reserved.video.sender.replaceTrack.mockRejectedValueOnce(new Error('replace'));

        const error = yield* platform
          .replaceProgramTracks(transceiver, replaceHarness.localMedia)
          .pipe(Effect.flip);
        assert.strictEqual(error.operation, 'replace-program-tracks');
      }).pipe(Effect.provide(replaceHarness.layer)),
    );

    const missingVideoHarness = makeNativePlatformTestHarness();
    const missingVideo = Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const reservation = yield* platform.reserveProgramTransceivers(peerConnection, 'answerer');
        const peer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
        peer.transceivers.push({
          sender: { replaceTrack: vi.fn(async (_track: unknown) => undefined) },
          receiver: { track: null },
        });
        const error = yield* platform.activateProgramTransceivers(reservation).pipe(Effect.flip);
        assert.strictEqual(error.operation, 'replace-program-tracks');
      }).pipe(Effect.provide(missingVideoHarness.layer)),
    );

    const missingAudioHarness = makeNativePlatformTestHarness();
    const missingAudio = Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const reservation = yield* platform.reserveProgramTransceivers(peerConnection, 'answerer');
        const peer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
        peer.transceivers.push({
          sender: { replaceTrack: vi.fn(async (_track: unknown) => undefined) },
          receiver: { track: new native.FakeTrack('video') },
        });

        const error = yield* platform.activateProgramTransceivers(reservation).pipe(Effect.flip);
        assert.strictEqual(error.operation, 'replace-program-tracks');
      }).pipe(Effect.provide(missingAudioHarness.layer)),
    );

    return reserve.pipe(
      Effect.andThen(answererReserve),
      Effect.andThen(replace),
      Effect.andThen(missingVideo),
      Effect.andThen(missingAudio),
    );
  });
});

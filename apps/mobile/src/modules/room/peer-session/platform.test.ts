import { assert, describe, it } from '@effect/vitest';
import {
  PeerSessionPlatform,
  PlatformError,
  type PlatformEvent,
} from '@tether/client-runtime/modules/peer-session';
import { Crypto, Effect } from 'effect';
import { vi } from 'vitest';

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

    constructor(readonly label: string) {}

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
    static readonly instances: FakePeerConnection[] = [];
    static failNext = false;
    readonly listeners = new Map<string, Set<(event: never) => void>>();
    readonly addTrack = vi.fn((_track: unknown, _stream: unknown) => undefined);
    readonly close = vi.fn();
    readonly createOffer = vi.fn(async () => ({ sdp: 'offer-sdp' }));
    readonly createAnswer = vi.fn(async () => ({ sdp: 'answer-sdp' }));
    readonly setLocalDescription = vi.fn(async () => undefined);
    readonly setRemoteDescription = vi.fn(async () => undefined);
    readonly addIceCandidate = vi.fn(async (_candidate: unknown) => undefined);
    connectionState = 'new';

    constructor(readonly configuration: unknown) {
      if (FakePeerConnection.failNext) {
        FakePeerConnection.failNext = false;
        throw new Error('peer connection unavailable');
      }
      FakePeerConnection.instances.push(this);
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

  const mediaStream = new FakeMediaStream();

  return {
    FakeDataChannel,
    FakeMediaStream,
    FakePeerConnection,
    mediaStream,
    getUserMedia: vi.fn(async (_constraints: unknown) => mediaStream),
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

const withPlatform = <A, E, R>(effect: Effect.Effect<A, E, R | PeerSessionPlatform>) =>
  effect.pipe(Effect.provide(nativePeerSessionPlatformLayer));

describe('native peer-session platform', () => {
  it.effect('provides native cryptography', () =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      assert.deepStrictEqual(yield* crypto.randomBytes(3), new Uint8Array([7, 7, 7]));
      assert.deepStrictEqual(
        yield* crypto.digest('SHA-256', new Uint8Array([1, 2, 3])),
        new Uint8Array([1, 2, 3]),
      );
    }).pipe(Effect.provide(nativeCryptoLayer)),
  );

  it.effect('acquires and releases local media', () =>
    Effect.scoped(
      withPlatform(
        Effect.gen(function* () {
          const platform = yield* PeerSessionPlatform;
          const handle = yield* platform.acquireLocalMedia;
          assert.strictEqual(
            mediaStreamValue(handle),
            native.mediaStream as unknown as ReturnType<typeof mediaStreamValue>,
          );
          assert.deepStrictEqual(native.getUserMedia.mock.calls[0]?.[0], {
            video: { facingMode: 'user' },
            audio: true,
          });
        }),
      ),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          assert.isTrue(native.mediaStream.track.stop.mock.calls.length > 0);
          assert.isTrue(native.mediaStream.release.mock.calls.length > 0);
        }),
      ),
    ),
  );

  it.effect('performs peer-connection and data-channel operations', () =>
    Effect.scoped(
      withPlatform(
        Effect.gen(function* () {
          const platform = yield* PeerSessionPlatform;
          const peerConnection = yield* platform.acquirePeerConnection([
            { urls: ['stun:stun.l.google.com:19302'] },
          ]);
          const nativePeer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
          const stream = { value: native.mediaStream };

          yield* platform.addLocalTracks(peerConnection, stream);
          const dataChannel = yield* platform.createDataChannel(peerConnection, 'chat');
          assert.strictEqual(platform.dataChannelLabel(dataChannel), 'chat');
          assert.deepStrictEqual(yield* platform.createOffer(peerConnection), {
            type: 'offer',
            sdp: 'offer-sdp',
          });
          assert.deepStrictEqual(yield* platform.createAnswer(peerConnection), {
            type: 'answer',
            sdp: 'answer-sdp',
          });
          yield* platform.setLocalDescription(peerConnection, { type: 'offer', sdp: 'offer' });
          yield* platform.setRemoteDescription(peerConnection, {
            type: 'answer',
            sdp: 'answer',
          });
          yield* platform.addIceCandidate(peerConnection, {
            candidate: 'candidate',
            sdpMid: '0',
            sdpMLineIndex: 0,
            usernameFragment: null,
          });
          yield* platform.sendDataChannelMessage(dataChannel, 'hello');

          assert.deepStrictEqual(nativePeer.configuration, {
            iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
          });
          assert.strictEqual(nativePeer.addTrack.mock.calls[0]?.[0], native.mediaStream.track);
          assert.deepStrictEqual(nativePeer.addIceCandidate.mock.calls[0]?.[0], {
            candidate: 'candidate',
            sdpMid: '0',
            sdpMLineIndex: 0,
          });
          assert.deepStrictEqual(
            (dataChannel.value as InstanceType<typeof native.FakeDataChannel>).send.mock.calls[0],
            ['hello'],
          );
        }),
      ),
    ),
  );

  it.effect('forwards peer-connection events and ignores incomplete events', () =>
    Effect.scoped(
      withPlatform(
        Effect.gen(function* () {
          const platform = yield* PeerSessionPlatform;
          const peerConnection = yield* platform.acquirePeerConnection([]);
          const nativePeer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
          const events: PlatformEvent[] = [];
          yield* platform.observePeerConnection(peerConnection, (event) => events.push(event));

          nativePeer.emit('icecandidate', { candidate: null });
          nativePeer.emit('icecandidate', {
            candidate: { candidate: 'candidate', sdpMid: undefined, sdpMLineIndex: undefined },
          });
          const channel = new native.FakeDataChannel('chat');
          nativePeer.emit('datachannel', { channel });
          nativePeer.emit('track', { streams: [] });
          nativePeer.emit('track', { streams: [native.mediaStream] });

          nativePeer.connectionState = 'disconnected';
          nativePeer.emit('connectionstatechange');
          nativePeer.connectionState = 'connected';
          nativePeer.emit('connectionstatechange');
          nativePeer.connectionState = 'disconnected';
          nativePeer.emit('connectionstatechange');
          nativePeer.connectionState = 'connected';
          nativePeer.emit('connectionstatechange');
          nativePeer.connectionState = 'failed';
          nativePeer.emit('connectionstatechange');
          nativePeer.emit('connectionstatechange');

          assert.deepStrictEqual(
            events.map((event) => event._tag),
            [
              'LocalIceCandidate',
              'RemoteDataChannel',
              'RemoteTrackReceived',
              'PeerConnectionConnected',
              'PeerConnectionInterrupted',
              'PeerConnectionRestored',
              'PeerConnectionFailed',
            ],
          );
        }),
      ),
    ),
  );

  it.effect('forwards data-channel lifecycle and messages', () =>
    Effect.scoped(
      withPlatform(
        Effect.gen(function* () {
          const platform = yield* PeerSessionPlatform;
          const peerConnection = yield* platform.acquirePeerConnection([]);
          const dataChannel = yield* platform.createDataChannel(peerConnection, 'chat');
          const nativeChannel = dataChannel.value as InstanceType<typeof native.FakeDataChannel>;
          const events: PlatformEvent[] = [];

          nativeChannel.readyState = 'open';
          yield* platform.observeDataChannel(dataChannel, (event) => events.push(event));
          nativeChannel.emit('message', { data: 'hello' });
          nativeChannel.readyState = 'closed';
          nativeChannel.emit('close');

          assert.deepStrictEqual(
            events.map((event) => event._tag),
            ['DataChannelOpened', 'DataChannelMessageReceived', 'DataChannelClosed'],
          );
        }),
      ),
    ),
  );

  it.effect('maps native failures to PlatformError', () =>
    withPlatform(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const failures = [
          platform.addLocalTracks({ value: {} }, { value: native.mediaStream }),
          platform.createDataChannel({ value: {} }, 'chat'),
          platform.createOffer({ value: {} }),
          platform.createAnswer({ value: {} }),
          platform.setLocalDescription({ value: {} }, { type: 'offer', sdp: 'offer' }),
          platform.setRemoteDescription({ value: {} }, { type: 'answer', sdp: 'answer' }),
          platform.addIceCandidate(
            { value: {} },
            {
              candidate: 'candidate',
              sdpMid: null,
              sdpMLineIndex: null,
              usernameFragment: null,
            },
          ),
          platform.sendDataChannelMessage({ value: {} }, 'hello'),
        ];
        const expectedOperations = [
          'add-local-tracks',
          'create-data-channel',
          'create-offer',
          'create-answer',
          'set-local-description',
          'set-remote-description',
          'add-ice-candidate',
          'send-message',
        ];

        for (const [index, failure] of failures.entries()) {
          const error = yield* failure.pipe(Effect.flip);
          assert.instanceOf(error, PlatformError);
          assert.strictEqual(error.operation, expectedOperations[index]);
        }
      }),
    ),
  );

  it.effect('maps resource-acquisition failures to PlatformError', () =>
    Effect.gen(function* () {
      native.getUserMedia.mockRejectedValueOnce(new Error('permission denied'));
      const mediaError = yield* Effect.scoped(
        withPlatform(Effect.flatMap(PeerSessionPlatform, (platform) => platform.acquireLocalMedia)),
      ).pipe(Effect.flip);
      assert.instanceOf(mediaError, PlatformError);
      assert.strictEqual(mediaError.operation, 'acquire-local-media');

      native.FakePeerConnection.failNext = true;
      const peerError = yield* Effect.scoped(
        withPlatform(
          Effect.flatMap(PeerSessionPlatform, (platform) => platform.acquirePeerConnection([])),
        ),
      ).pipe(Effect.flip);
      assert.instanceOf(peerError, PlatformError);
      assert.strictEqual(peerError.operation, 'acquire-peer-connection');
    }),
  );

  it.effect('ignores redundant and post-failure connection transitions', () =>
    Effect.scoped(
      withPlatform(
        Effect.gen(function* () {
          const platform = yield* PeerSessionPlatform;
          const peerConnection = yield* platform.acquirePeerConnection([]);
          const nativePeer = peerConnection.value as InstanceType<typeof native.FakePeerConnection>;
          const events: PlatformEvent[] = [];
          yield* platform.observePeerConnection(peerConnection, (event) => events.push(event));

          nativePeer.connectionState = 'connected';
          nativePeer.emit('connectionstatechange');
          // A duplicate 'connected' notification is dropped.
          nativePeer.emit('connectionstatechange');
          nativePeer.connectionState = 'failed';
          nativePeer.emit('connectionstatechange');
          // A 'connected' after a terminal failure is dropped.
          nativePeer.connectionState = 'connected';
          nativePeer.emit('connectionstatechange');

          assert.deepStrictEqual(
            events.map((event) => event._tag),
            ['PeerConnectionConnected', 'PeerConnectionFailed'],
          );
        }),
      ),
    ),
  );

  it.effect('does not open a data channel that is not yet ready', () =>
    Effect.scoped(
      withPlatform(
        Effect.gen(function* () {
          const platform = yield* PeerSessionPlatform;
          const peerConnection = yield* platform.acquirePeerConnection([]);
          const dataChannel = yield* platform.createDataChannel(peerConnection, 'chat');
          const nativeChannel = dataChannel.value as InstanceType<typeof native.FakeDataChannel>;
          const events: PlatformEvent[] = [];

          // The channel is still 'connecting' when observation begins.
          nativeChannel.readyState = 'connecting';
          yield* platform.observeDataChannel(dataChannel, (event) => events.push(event));

          assert.deepStrictEqual(events, []);
        }),
      ),
    ),
  );
});

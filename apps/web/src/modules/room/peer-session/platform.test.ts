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
  tuneSenderParameters,
  webCryptoLayer,
  webPeerSessionPlatformLayer,
} from './platform';

class FakeTrack {
  contentHint = '';
  readonly stop = vi.fn();
  readonly kind: 'audio' | 'video';

  constructor(kind: 'audio' | 'video' = 'audio') {
    this.kind = kind;
  }
}

class FakeSender {
  readonly replaceTrack = vi.fn(async (_track: unknown) => undefined);
  readonly setParameters = vi.fn(async (_parameters: unknown) => undefined);
  readonly parameters = {
    encodings: [{ priority: 'low', networkPriority: 'low' }],
    degradationPreference: 'balanced',
  };
  readonly getParameters = vi.fn(() => this.parameters);
}

class FakeMediaStream {
  readonly track = new FakeTrack('audio');
  readonly videoTrack = new FakeTrack('video');
  readonly audioTrack = new FakeTrack('audio');
  readonly getTracks = vi.fn(() => [this.track]);
  readonly getVideoTracks = vi.fn(() => [this.videoTrack]);
  readonly getAudioTracks = vi.fn(() => [this.audioTrack]);
}

class FakeDataChannel {
  readonly listeners = new Map<string, Set<(event: never) => void>>();
  readonly send = vi.fn();
  readonly close = vi.fn(() => {
    this.readyState = 'closed';
  });
  readyState = 'connecting';
  bufferedAmount = 0;
  binaryType = 'blob';
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
  readonly localSender = new FakeSender();
  readonly transceivers: Array<{
    readonly sender: FakeSender;
    readonly receiver: { readonly track: FakeTrack };
    direction: RTCRtpTransceiverDirection;
  }> = [];
  readonly transceiverSenders: FakeSender[] = [];
  readonly addTrack = vi.fn((_track: unknown, _stream: unknown) => this.localSender);
  readonly addTransceiver = vi.fn((kind: 'audio' | 'video', _init: unknown) => {
    const sender = new FakeSender();
    this.transceiverSenders.push(sender);
    const transceiver = {
      sender,
      receiver: { track: new FakeTrack(kind) },
      direction: 'sendrecv' as RTCRtpTransceiverDirection,
    };
    this.transceivers.push(transceiver);
    return transceiver;
  });
  readonly getTransceivers = vi.fn(() => this.transceivers);
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
  vi.stubGlobal(
    'MediaStream',
    class {
      readonly addTrack = vi.fn();
      constructor(_tracks?: ReadonlyArray<unknown>) {}
    },
  );
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
      emitRemoteTrack: (handle, stream) => {
        if (stream !== null) {
          peer(handle).emit('track', { streams: [stream.value], track: new FakeTrack() });
        }
      },
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

  it.effect('marks observed channels for arraybuffer receipt and sends binary frames', () => {
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

        yield* platform.observeDataChannel(dataChannel, () => {});
        assert.strictEqual(channel.binaryType, 'arraybuffer');

        const payload = new Uint8Array([1, 2, 3, 4]).buffer;
        yield* platform.sendDataChannelBinary(dataChannel, payload);
        assert.strictEqual(channel.send.mock.calls.length, 1);
        assert.strictEqual(channel.send.mock.calls[0]?.[0], payload);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it.effect('reserves and replaces browser watch-along tracks', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const transceiver = yield* platform.reserveProgramTransceivers(peerConnection, 'offerer');

        yield* platform.replaceProgramTracks(transceiver, harness.localMedia);
        yield* platform.replaceProgramTracks(transceiver, null);

        const peer = peerConnection.value as FakePeerConnection;
        assert.deepStrictEqual(peer.addTransceiver.mock.calls, [
          ['video', { direction: 'sendrecv' }],
          ['audio', { direction: 'sendrecv' }],
        ]);
        const reserved = transceiver.value as {
          readonly _tag: 'reserved';
          readonly video: { readonly sender: FakeSender };
          readonly audio: { readonly sender: FakeSender };
        };
        assert.deepStrictEqual(reserved.video.sender.replaceTrack.mock.calls, [
          [harness.mediaStream.videoTrack],
          [null],
        ]);
        assert.deepStrictEqual(reserved.audio.sender.replaceTrack.mock.calls, [
          [harness.mediaStream.audioTrack],
          [null],
        ]);
        assert.strictEqual(harness.mediaStream.videoTrack.contentHint, 'motion');
        assert.strictEqual(
          reserved.video.sender.parameters.degradationPreference,
          'maintain-framerate',
        );
        assert.strictEqual(reserved.video.sender.parameters.encodings[0]?.priority, 'low');
        assert.strictEqual(reserved.audio.sender.parameters.encodings[0]?.priority, 'medium');
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it.effect('adopts program transceivers created from the remote offer', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const reservation = yield* platform.reserveProgramTransceivers(peerConnection, 'answerer');
        const peer = peerConnection.value as FakePeerConnection;
        const video = {
          sender: new FakeSender(),
          receiver: { track: new FakeTrack('video') },
          direction: 'recvonly' as RTCRtpTransceiverDirection,
        };
        const audio = {
          sender: new FakeSender(),
          receiver: { track: new FakeTrack('audio') },
          direction: 'recvonly' as RTCRtpTransceiverDirection,
        };
        peer.transceivers.push(video, audio);

        yield* platform.activateProgramTransceivers(reservation);
        yield* platform.replaceProgramTracks(reservation, harness.localMedia);

        assert.strictEqual(peer.addTransceiver.mock.calls.length, 0);
        assert.strictEqual(video.direction, 'sendrecv');
        assert.strictEqual(audio.direction, 'sendrecv');
        assert.deepStrictEqual(video.sender.replaceTrack.mock.calls, [
          [harness.mediaStream.videoTrack],
        ]);
        assert.deepStrictEqual(audio.sender.replaceTrack.mock.calls, [
          [harness.mediaStream.audioTrack],
        ]);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it('feature-detects sender tuning and preserves already-tuned parameters', () => {
    const unsupported = { encodings: [{}] } as RTCRtpSendParameters;
    assert.isFalse(tuneSenderParameters(unsupported, 'voice-audio'));
    assert.isTrue(tuneSenderParameters(unsupported, 'program-video'));
    assert.strictEqual(unsupported.degradationPreference, 'maintain-framerate');

    const voice = {
      encodings: [{ priority: 'low', networkPriority: 'medium' }],
    } as RTCRtpSendParameters;
    assert.isTrue(tuneSenderParameters(voice, 'voice-audio'));
    assert.deepStrictEqual(voice.encodings[0], { priority: 'high', networkPriority: 'high' });
    assert.isFalse(tuneSenderParameters(voice, 'voice-audio'));

    const programVideo = {
      encodings: [{ priority: 'high', networkPriority: 'high' }],
      degradationPreference: 'balanced',
    } as RTCRtpSendParameters;
    assert.isTrue(tuneSenderParameters(programVideo, 'program-video'));
    assert.deepStrictEqual(programVideo.encodings[0], {
      priority: 'low',
      networkPriority: 'low',
      maxBitrate: 8_000_000,
    });
    assert.strictEqual(programVideo.degradationPreference, 'maintain-framerate');
  });

  it.effect('gives local voice the highest supported sender priority', () => {
    const harness = makeWebPlatformTestHarness();
    harness.mediaStream.getTracks.mockReturnValue([
      harness.mediaStream.videoTrack,
      harness.mediaStream.audioTrack,
    ]);
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        yield* platform.addLocalTracks(peerConnection, harness.localMedia);
        const peer = peerConnection.value as FakePeerConnection;
        assert.strictEqual(peer.localSender.parameters.encodings[0]?.priority, 'high');
        assert.strictEqual(peer.localSender.parameters.encodings[0]?.networkPriority, 'high');
        assert.strictEqual(peer.localSender.setParameters.mock.calls.length, 1);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it.effect('treats rejected optional sender tuning as best effort', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const peer = peerConnection.value as FakePeerConnection;
        peer.localSender.setParameters.mockRejectedValueOnce(new Error('unsupported tuning'));
        yield* platform.addLocalTracks(peerConnection, harness.localMedia);
        assert.strictEqual(peer.localSender.setParameters.mock.calls.length, 1);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it.effect('groups multiple streamless program tracks into one media stream', () => {
    const harness = makeWebPlatformTestHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const events: Array<{
          readonly _tag: string;
          readonly stream?: { readonly value: unknown };
        }> = [];
        yield* platform.observePeerConnection(peerConnection, (event) => events.push(event));
        const peer = peerConnection.value as FakePeerConnection;
        peer.emit('track', { streams: [], track: new FakeTrack('video') });
        peer.emit('track', { streams: [], track: new FakeTrack('audio') });

        assert.deepStrictEqual(
          events.map((event) => event._tag),
          ['RemoteSharedTrackReceived', 'RemoteSharedTrackReceived'],
        );
        assert.strictEqual(events[0]?.stream?.value, events[1]?.stream?.value);
        const stream = events[0]?.stream?.value as { readonly addTrack: ReturnType<typeof vi.fn> };
        assert.strictEqual(stream.addTrack.mock.calls.length, 1);
      }).pipe(Effect.provide(harness.layer)),
    );
  });

  it.effect('maps program transceiver and replacement failures', () => {
    const reserveHarness = makeWebPlatformTestHarness();
    const reserve = Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const peer = peerConnection.value as FakePeerConnection;
        peer.addTransceiver.mockImplementationOnce(() => {
          throw new Error('reserve');
        });
        const error = yield* platform
          .reserveProgramTransceivers(peerConnection, 'offerer')
          .pipe(Effect.flip);
        assert.strictEqual(error.operation, 'reserve-program-transceivers');
      }).pipe(Effect.provide(reserveHarness.layer)),
    );
    const replaceHarness = makeWebPlatformTestHarness();
    const replace = Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const transceiver = yield* platform.reserveProgramTransceivers(peerConnection, 'offerer');
        const value = transceiver.value as { readonly video: { readonly sender: FakeSender } };
        value.video.sender.replaceTrack.mockRejectedValueOnce(new Error('replace'));
        const error = yield* platform
          .replaceProgramTracks(transceiver, replaceHarness.localMedia)
          .pipe(Effect.flip);
        assert.strictEqual(error.operation, 'replace-program-tracks');
      }).pipe(Effect.provide(replaceHarness.layer)),
    );
    const resolveHarness = makeWebPlatformTestHarness();
    const resolve = Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* PeerSessionPlatform;
        const peerConnection = yield* platform.acquirePeerConnection([]);
        const reservation = yield* platform.reserveProgramTransceivers(peerConnection, 'answerer');
        const peer = peerConnection.value as FakePeerConnection;
        peer.transceivers.push({
          sender: new FakeSender(),
          receiver: { track: new FakeTrack('video') },
          direction: 'recvonly',
        });

        const error = yield* platform.activateProgramTransceivers(reservation).pipe(Effect.flip);
        assert.strictEqual(error.operation, 'replace-program-tracks');
      }).pipe(Effect.provide(resolveHarness.layer)),
    );
    return reserve.pipe(Effect.andThen(replace), Effect.andThen(resolve));
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

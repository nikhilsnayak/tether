import { assert, describe, it } from '@effect/vitest';
import {
  PeerSessionPlatform,
  PlatformError,
  type DataChannelHandle,
  type IceCandidate,
  type IceServer,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PlatformEvent,
  type SessionDescription,
} from '@tether/client-runtime/modules/peer-session';
import { Effect, Exit, type Layer, Scope } from 'effect';

type ConnectionState = 'connected' | 'disconnected' | 'failed';
type DataChannelState = 'connecting' | 'open' | 'closed';

export interface PeerSessionPlatformTestHarness {
  readonly layer: Layer.Layer<PeerSessionPlatform>;
  readonly localMedia: MediaStreamHandle;
  readonly controls: {
    readonly failLocalMediaAcquisition: () => void;
    readonly failPeerConnectionAcquisition: () => void;
    readonly emitIceCandidate: (
      peerConnection: PeerConnectionHandle,
      candidate: IceCandidate | null,
    ) => void;
    readonly emitRemoteDataChannel: (peerConnection: PeerConnectionHandle, label: string) => void;
    readonly emitRemoteTrack: (
      peerConnection: PeerConnectionHandle,
      stream: MediaStreamHandle | null,
    ) => void;
    readonly transitionConnection: (
      peerConnection: PeerConnectionHandle,
      state: ConnectionState,
    ) => void;
    readonly setDataChannelState: (dataChannel: DataChannelHandle, state: DataChannelState) => void;
    readonly emitDataChannelMessage: (dataChannel: DataChannelHandle, data: unknown) => void;
    readonly emitDataChannelClose: (dataChannel: DataChannelHandle) => void;
  };
  readonly observations: {
    readonly iceServers: (peerConnection: PeerConnectionHandle) => ReadonlyArray<IceServer>;
    readonly addedTrackCount: (peerConnection: PeerConnectionHandle) => number;
    readonly localDescriptions: (
      peerConnection: PeerConnectionHandle,
    ) => ReadonlyArray<Required<SessionDescription>>;
    readonly remoteDescriptions: (
      peerConnection: PeerConnectionHandle,
    ) => ReadonlyArray<Required<SessionDescription>>;
    readonly iceCandidates: (
      peerConnection: PeerConnectionHandle,
    ) => ReadonlyArray<Pick<IceCandidate, 'candidate' | 'sdpMid' | 'sdpMLineIndex'>>;
    readonly sentMessages: (dataChannel: DataChannelHandle) => ReadonlyArray<string>;
    readonly peerConnectionCloseCount: (peerConnection: PeerConnectionHandle) => number;
    readonly peerConnectionListenerCount: (peerConnection: PeerConnectionHandle) => number;
    readonly dataChannelListenerCount: (dataChannel: DataChannelHandle) => number;
  };
}

const iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }] as const;
const candidate: IceCandidate = {
  candidate: 'candidate',
  sdpMid: '0',
  sdpMLineIndex: 0,
  usernameFragment: null,
};

export const describePeerSessionPlatformContract = (
  platformName: string,
  makeHarness: () => PeerSessionPlatformTestHarness,
) => {
  const withPlatform = <A, E, R>(
    harness: PeerSessionPlatformTestHarness,
    effect: Effect.Effect<A, E, R | PeerSessionPlatform>,
  ) => effect.pipe(Effect.provide(harness.layer));

  describe(`${platformName} peer-session platform contract`, () => {
    it('creates fresh state for every fixture request', () => {
      const first = makeHarness();
      const second = makeHarness();

      assert.notStrictEqual(first, second);
      assert.notStrictEqual(first.localMedia.value, second.localMedia.value);
    });

    it.effect('maps peer-connection and data-channel operations', () => {
      const harness = makeHarness();
      return Effect.scoped(
        withPlatform(
          harness,
          Effect.gen(function* () {
            const platform = yield* PeerSessionPlatform;
            const peerConnection = yield* platform.acquirePeerConnection(iceServers);

            yield* platform.addLocalTracks(peerConnection, harness.localMedia);
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
            yield* platform.addIceCandidate(peerConnection, candidate);
            yield* platform.sendDataChannelMessage(dataChannel, 'hello');

            assert.deepStrictEqual(harness.observations.iceServers(peerConnection), iceServers);
            assert.strictEqual(harness.observations.addedTrackCount(peerConnection), 1);
            assert.deepStrictEqual(harness.observations.localDescriptions(peerConnection), [
              { type: 'offer', sdp: 'offer' },
            ]);
            assert.deepStrictEqual(harness.observations.remoteDescriptions(peerConnection), [
              { type: 'answer', sdp: 'answer' },
            ]);
            assert.deepStrictEqual(harness.observations.iceCandidates(peerConnection), [
              { candidate: 'candidate', sdpMid: '0', sdpMLineIndex: 0 },
            ]);
            assert.deepStrictEqual(harness.observations.sentMessages(dataChannel), ['hello']);
          }),
        ),
      );
    });

    it.effect('forwards peer events and ignores incomplete input', () => {
      const harness = makeHarness();
      return Effect.scoped(
        withPlatform(
          harness,
          Effect.gen(function* () {
            const platform = yield* PeerSessionPlatform;
            const peerConnection = yield* platform.acquirePeerConnection([]);
            const events: PlatformEvent[] = [];
            yield* platform.observePeerConnection(peerConnection, (event) => events.push(event));

            harness.controls.emitIceCandidate(peerConnection, null);
            harness.controls.emitIceCandidate(peerConnection, candidate);
            harness.controls.emitRemoteDataChannel(peerConnection, 'chat');
            harness.controls.emitRemoteTrack(peerConnection, null);
            harness.controls.emitRemoteTrack(peerConnection, harness.localMedia);
            harness.controls.transitionConnection(peerConnection, 'disconnected');
            harness.controls.transitionConnection(peerConnection, 'connected');
            harness.controls.transitionConnection(peerConnection, 'disconnected');
            harness.controls.transitionConnection(peerConnection, 'connected');
            harness.controls.transitionConnection(peerConnection, 'failed');
            harness.controls.transitionConnection(peerConnection, 'failed');

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
            const iceEvent = events.find((event) => event._tag === 'LocalIceCandidate');
            assert.isDefined(iceEvent);
            if (iceEvent?._tag === 'LocalIceCandidate') {
              assert.deepStrictEqual(iceEvent.candidate, candidate);
            }
          }),
        ),
      );
    });

    it.effect('deduplicates connection transitions after a terminal failure', () => {
      const harness = makeHarness();
      return Effect.scoped(
        withPlatform(
          harness,
          Effect.gen(function* () {
            const platform = yield* PeerSessionPlatform;
            const peerConnection = yield* platform.acquirePeerConnection([]);
            const events: PlatformEvent[] = [];
            yield* platform.observePeerConnection(peerConnection, (event) => events.push(event));

            harness.controls.transitionConnection(peerConnection, 'connected');
            harness.controls.transitionConnection(peerConnection, 'connected');
            harness.controls.transitionConnection(peerConnection, 'failed');
            harness.controls.transitionConnection(peerConnection, 'connected');

            assert.deepStrictEqual(
              events.map((event) => event._tag),
              ['PeerConnectionConnected', 'PeerConnectionFailed'],
            );
          }),
        ),
      );
    });

    it.effect('forwards data-channel open, message, and close events', () => {
      const harness = makeHarness();
      return Effect.scoped(
        withPlatform(
          harness,
          Effect.gen(function* () {
            const platform = yield* PeerSessionPlatform;
            const peerConnection = yield* platform.acquirePeerConnection([]);
            const dataChannel = yield* platform.createDataChannel(peerConnection, 'chat');
            const events: PlatformEvent[] = [];

            harness.controls.setDataChannelState(dataChannel, 'open');
            yield* platform.observeDataChannel(dataChannel, (event) => events.push(event));
            harness.controls.emitDataChannelMessage(dataChannel, 'hello');
            harness.controls.setDataChannelState(dataChannel, 'closed');
            harness.controls.emitDataChannelClose(dataChannel);

            assert.deepStrictEqual(
              events.map((event) => event._tag),
              ['DataChannelOpened', 'DataChannelMessageReceived', 'DataChannelClosed'],
            );
          }),
        ),
      );
    });

    it.effect('does not open a data channel that is not ready', () => {
      const harness = makeHarness();
      return Effect.scoped(
        withPlatform(
          harness,
          Effect.gen(function* () {
            const platform = yield* PeerSessionPlatform;
            const peerConnection = yield* platform.acquirePeerConnection([]);
            const dataChannel = yield* platform.createDataChannel(peerConnection, 'chat');
            const events: PlatformEvent[] = [];

            harness.controls.setDataChannelState(dataChannel, 'connecting');
            yield* platform.observeDataChannel(dataChannel, (event) => events.push(event));

            assert.deepStrictEqual(events, []);
          }),
        ),
      );
    });

    it.effect('maps operation failures to PlatformError operations', () => {
      const harness = makeHarness();
      return withPlatform(
        harness,
        Effect.gen(function* () {
          const platform = yield* PeerSessionPlatform;
          const failures = [
            platform.addLocalTracks({ value: {} }, harness.localMedia),
            platform.createDataChannel({ value: {} }, 'chat'),
            platform.createOffer({ value: {} }),
            platform.createAnswer({ value: {} }),
            platform.setLocalDescription({ value: {} }, { type: 'offer', sdp: 'offer' }),
            platform.setRemoteDescription({ value: {} }, { type: 'answer', sdp: 'answer' }),
            platform.addIceCandidate({ value: {} }, candidate),
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
      );
    });

    it.effect('maps acquisition failures to PlatformError operations', () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        harness.controls.failLocalMediaAcquisition();
        const mediaError = yield* Effect.scoped(
          withPlatform(
            harness,
            Effect.flatMap(PeerSessionPlatform, (platform) => platform.acquireLocalMedia),
          ),
        ).pipe(Effect.flip);
        assert.instanceOf(mediaError, PlatformError);
        assert.strictEqual(mediaError.operation, 'acquire-local-media');

        harness.controls.failPeerConnectionAcquisition();
        const peerError = yield* Effect.scoped(
          withPlatform(
            harness,
            Effect.flatMap(PeerSessionPlatform, (platform) => platform.acquirePeerConnection([])),
          ),
        ).pipe(Effect.flip);
        assert.instanceOf(peerError, PlatformError);
        assert.strictEqual(peerError.operation, 'acquire-peer-connection');
      });
    });

    it.effect('closes resources and removes listeners on scope exit', () => {
      const harness = makeHarness();
      return withPlatform(
        harness,
        Effect.gen(function* () {
          const platform = yield* PeerSessionPlatform;
          const scope = yield* Scope.make();
          const peerConnection = yield* platform
            .acquirePeerConnection([])
            .pipe(Scope.provide(scope));
          const dataChannel = yield* platform.createDataChannel(peerConnection, 'chat');
          yield* platform
            .observePeerConnection(peerConnection, () => undefined)
            .pipe(Scope.provide(scope));
          yield* platform
            .observeDataChannel(dataChannel, () => undefined)
            .pipe(Scope.provide(scope));

          assert.isAbove(harness.observations.peerConnectionListenerCount(peerConnection), 0);
          assert.isAbove(harness.observations.dataChannelListenerCount(dataChannel), 0);
          yield* Scope.close(scope, Exit.void);

          assert.strictEqual(harness.observations.peerConnectionCloseCount(peerConnection), 1);
          assert.strictEqual(harness.observations.peerConnectionListenerCount(peerConnection), 0);
          assert.strictEqual(harness.observations.dataChannelListenerCount(dataChannel), 0);
        }),
      );
    });
  });
};

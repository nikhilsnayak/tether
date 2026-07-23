import { assert, it } from '@effect/vitest';
import { DUSK_SUITE_TEMPLATE_ID, PeerId, RoomId } from '@tether/contracts/modules/room';
import { Effect, Layer } from 'effect';
import { AtomRegistry } from 'effect/unstable/reactivity';

import type { MediaStreamHandle, PeerSessionEvent } from '../peer-session/Model';
import { PeerSessionEventSink } from '../peer-session/Services';
import { initialPeerSessionView } from '../peer-session/View';
import {
  peerLocalStreamAtom,
  peerRemoteStreamAtom,
  peerSessionEventSinkLayer,
  peerSessionViewAtom,
} from './PeerSessionAtoms';

it.effect('projects session events into the atom registry', () =>
  Effect.gen(function* () {
    const registry = AtomRegistry.make();
    const layer = peerSessionEventSinkLayer.pipe(
      Layer.provide(Layer.succeed(AtomRegistry.AtomRegistry, registry)),
    );
    const localStream: MediaStreamHandle = { value: { id: 'local' } };
    const remoteStream: MediaStreamHandle = { value: { id: 'remote' } };
    const peerId = PeerId.make('pppppppppppp');

    yield* Effect.gen(function* () {
      const sink = yield* PeerSessionEventSink;
      yield* sink.emit({ _tag: 'LocalStreamReady', stream: localStream });
      yield* sink.emit({ _tag: 'RemoteStreamReady', stream: remoteStream });
      yield* sink.emit({ _tag: 'RoomEventsReady' });
      yield* sink.emit({
        _tag: 'RemoteAvatarPoseChanged',
        pose: { sequence: 0, x: 1, z: 2, yaw: 0, action: 'idle' },
      });
      yield* sink.emit({
        _tag: 'RemoteMediaStateChanged',
        mediaState: { revision: 0, cameraOn: false, microphoneOn: true },
      });

      assert.strictEqual(registry.get(peerLocalStreamAtom), localStream);
      assert.strictEqual(registry.get(peerRemoteStreamAtom), remoteStream);
      assert.isTrue(registry.get(peerSessionViewAtom).roomEventsReady);
      assert.strictEqual(registry.get(peerSessionViewAtom).remoteAvatarPose?.x, 1);
      assert.isFalse(registry.get(peerSessionViewAtom).remoteMediaState?.cameraOn);

      yield* sink.emit({
        _tag: 'TransportLost',
        peerId,
        diagnostic: 'direct-path-unavailable',
      });
      assert.isNull(registry.get(peerRemoteStreamAtom));
      assert.strictEqual(registry.get(peerSessionViewAtom).status, 'transport-lost');
      assert.isNull(registry.get(peerSessionViewAtom).remoteAvatarPose);
      assert.isNull(registry.get(peerSessionViewAtom).remoteMediaState);

      yield* sink.emit({ _tag: 'RemoteStreamReady', stream: remoteStream });
      yield* sink.emit({ _tag: 'PeerDeparted', peerId });
      assert.isNull(registry.get(peerRemoteStreamAtom));
      assert.strictEqual(registry.get(peerSessionViewAtom).status, 'peer-departed');

      const resetEvents: ReadonlyArray<PeerSessionEvent> = [
        { _tag: 'SessionFailed' },
        { _tag: 'SignalingDisconnected' },
        { _tag: 'RoomJoinRejected', reason: 'room-full' },
        { _tag: 'RoomJoinRejected', reason: 'server-at-capacity' },
        { _tag: 'SessionStarted' },
      ];

      for (const event of resetEvents) {
        yield* sink.emit({ _tag: 'LocalStreamReady', stream: localStream });
        yield* sink.emit({ _tag: 'RemoteStreamReady', stream: remoteStream });
        yield* sink.emit(event);
        assert.isNull(registry.get(peerLocalStreamAtom));
        assert.isNull(registry.get(peerRemoteStreamAtom));
      }
    }).pipe(Effect.provide(layer));

    registry.dispose();
  }),
);

it.effect('isolates the same atom definitions across separate registries', () =>
  Effect.gen(function* () {
    const registryA = AtomRegistry.make();
    const registryB = AtomRegistry.make();
    const sinkA = peerSessionEventSinkLayer.pipe(
      Layer.provide(Layer.succeed(AtomRegistry.AtomRegistry, registryA)),
    );
    const sinkB = peerSessionEventSinkLayer.pipe(
      Layer.provide(Layer.succeed(AtomRegistry.AtomRegistry, registryB)),
    );
    const localStreamA: MediaStreamHandle = { value: { id: 'local-a' } };
    const remoteStreamA: MediaStreamHandle = { value: { id: 'remote-a' } };
    const localStreamB: MediaStreamHandle = { value: { id: 'local-b' } };
    const roomIdA = RoomId.make('abc-defg-hij');
    const roomIdB = RoomId.make('klm-nopq-rst');
    const peerId = PeerId.make('qqqqqqqqqqqq');

    yield* Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const sink = yield* PeerSessionEventSink;
        yield* sink.emit({ _tag: 'LocalStreamReady', stream: localStreamA });
        yield* sink.emit({ _tag: 'RemoteStreamReady', stream: remoteStreamA });
        yield* sink.emit({
          _tag: 'RoomOpened',
          roomId: roomIdA,
          roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
        });
        yield* sink.emit({ _tag: 'Connected', peerId });
      }).pipe(Effect.provide(sinkA));

      // The second registry shares the atom definitions but must retain initial state.
      assert.isNull(registryB.get(peerLocalStreamAtom));
      assert.isNull(registryB.get(peerRemoteStreamAtom));
      assert.deepStrictEqual(registryB.get(peerSessionViewAtom), initialPeerSessionView);

      yield* Effect.gen(function* () {
        const sink = yield* PeerSessionEventSink;
        yield* sink.emit({ _tag: 'LocalStreamReady', stream: localStreamB });
        yield* sink.emit({
          _tag: 'RoomOpened',
          roomId: roomIdB,
          roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
        });
        yield* sink.emit({ _tag: 'WaitingForPeer' });
      }).pipe(Effect.provide(sinkB));

      // The first registry kept only the values emitted into it.
      assert.strictEqual(registryA.get(peerLocalStreamAtom), localStreamA);
      assert.strictEqual(registryA.get(peerRemoteStreamAtom), remoteStreamA);
      assert.strictEqual(registryA.get(peerSessionViewAtom).status, 'connected');
      assert.strictEqual(registryA.get(peerSessionViewAtom).roomId, roomIdA);

      // The second registry holds its own divergent values.
      assert.strictEqual(registryB.get(peerLocalStreamAtom), localStreamB);
      assert.isNull(registryB.get(peerRemoteStreamAtom));
      assert.strictEqual(registryB.get(peerSessionViewAtom).status, 'waiting-for-peer');
      assert.strictEqual(registryB.get(peerSessionViewAtom).roomId, roomIdB);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          registryA.dispose();
          registryB.dispose();
        }),
      ),
    );
  }),
);

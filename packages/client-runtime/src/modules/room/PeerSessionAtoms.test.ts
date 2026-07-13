import { assert, it } from '@effect/vitest';
import { PeerId } from '@tether/contracts/modules/room';
import { Effect, Layer } from 'effect';
import { AtomRegistry } from 'effect/unstable/reactivity';

import type { MediaStreamHandle, PeerSessionEvent } from '../peer-session/Model';
import { PeerSessionEventSink } from '../peer-session/Services';
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
      yield* sink.emit({ _tag: 'ChatReady' });

      assert.strictEqual(registry.get(peerLocalStreamAtom), localStream);
      assert.strictEqual(registry.get(peerRemoteStreamAtom), remoteStream);
      assert.isTrue(registry.get(peerSessionViewAtom).chatReady);

      yield* sink.emit({ _tag: 'TransportLost', peerId });
      assert.isNull(registry.get(peerRemoteStreamAtom));
      assert.strictEqual(registry.get(peerSessionViewAtom).status, 'transport-lost');

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

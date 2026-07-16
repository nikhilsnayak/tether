import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import { PlatformError } from './Platform';
import { bob, makePeerSessionTestHarness } from './test/PeerSessionTestHarness';

describe('peer-session actor — detachment', () => {
  it.effect('crosses one probe and declares readiness only after every condition holds', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.receiveAnswer(bob, 'answer-sdp', 0);
        yield* fixture.connectionConnected();
        yield* fixture.openRoomEvents();
        yield* fixture.receiveDetachProbe();

        assert.notInclude(
          fixture.operations,
          'sendDataChannelMessage:{"version":1,"type":"detach-probe"}',
        );
        assert.deepStrictEqual(fixture.readinessEpochs, []);

        yield* fixture.gatheringComplete();
        yield* fixture.gatheringComplete();
        yield* fixture.receiveDetachProbe();
        yield* fixture.receiveDetachProbe();

        assert.strictEqual(
          fixture.operations.filter(
            (operation) =>
              operation === 'sendDataChannelMessage:{"version":1,"type":"detach-probe"}',
          ).length,
          1,
        );
        assert.deepStrictEqual(fixture.readinessEpochs, [0]);
      }),
    ),
  );

  it.effect('does not make signaling loss harmless when readiness delivery fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempts = 0;
        const fixture = yield* makePeerSessionTestHarness(
          undefined,
          undefined,
          undefined,
          undefined,
          () => {
            attempts += 1;
            return attempts === 1 ? Effect.fail('offline') : Effect.void;
          },
        );
        yield* fixture.openRoom(bob);
        yield* fixture.receiveAnswer(bob, 'answer-sdp', 0);
        yield* fixture.connectionConnected();
        yield* fixture.openRoomEvents();
        yield* fixture.gatheringComplete();
        yield* fixture.receiveDetachProbe();

        assert.strictEqual(attempts, 1);
        assert.strictEqual(yield* fixture.signalingEnded(), 'stop');

        yield* fixture.gatheringComplete();
        assert.strictEqual(attempts, 2);
        assert.strictEqual(yield* fixture.signalingEnded(), 'continue');
        assert.isTrue(fixture.events.some((event) => event._tag === 'SessionDetached'));
      }),
    ),
  );

  it.effect('treats post-readiness signaling loss as one implicit detach', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.receiveAnswer(bob, 'answer-sdp', 0);
        yield* fixture.connectionConnected();
        yield* fixture.openRoomEvents();
        yield* fixture.gatheringComplete();
        yield* fixture.receiveDetachProbe();

        assert.strictEqual(yield* fixture.signalingEnded(), 'continue');
        assert.strictEqual(yield* fixture.signalingEnded(), 'continue');
        yield* fixture.detached();
        yield* fixture.gatheringComplete();

        assert.strictEqual(
          fixture.events.filter((event) => event._tag === 'SessionDetached').length,
          1,
        );
      }),
    ),
  );

  it.effect('uses the data channel for departure only after detachment', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.receiveAnswer(bob, 'answer-sdp', 0);
        yield* fixture.connectionConnected();
        yield* fixture.openRoomEvents();

        yield* fixture.receiveLeave();
        assert.isFalse(fixture.events.some((event) => event._tag === 'PeerDeparted'));

        yield* fixture.detached();
        yield* fixture.sendLeave();
        assert.include(fixture.operations, 'sendDataChannelMessage:{"version":1,"type":"leave"}');
        yield* fixture.receiveLeave();
        assert.isTrue(
          fixture.events.some((event) => event._tag === 'PeerDeparted' && event.peerId === bob),
        );
        assert.include(fixture.operations, 'closePeerConnection');
      }),
    ),
  );

  it.effect('ends instead of reconnecting when direct transport fails after detachment', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.detached();
        const acquisitions = fixture.operations.filter(
          (operation) => operation === 'acquirePeerConnection',
        ).length;

        yield* fixture.actor({
          _tag: 'LocalIceCandidate',
          peerConnection: fixture.peerConnection,
          candidate: {
            candidate: 'post-detach-ice',
            sdpMid: '0',
            sdpMLineIndex: 0,
            usernameFragment: null,
          },
        });

        yield* fixture.connectionFailed();

        assert.strictEqual(
          fixture.operations.filter((operation) => operation === 'acquirePeerConnection').length,
          acquisitions,
        );
        assert.isTrue(
          fixture.events.some((event) => event._tag === 'TransportLost' && event.peerId === bob),
        );
        assert.notInclude(fixture.operations, 'sendSignal:ice:post-detach-ice');
      }),
    ),
  );

  it.effect('contains leave-envelope send failures after detachment', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          sendDataChannelMessage: () =>
            Effect.fail(new PlatformError({ operation: 'send-message', cause: 'offline' })),
        });
        yield* fixture.sendLeave();
        yield* fixture.openRoom(bob);
        yield* fixture.receiveAnswer(bob, 'answer-sdp', 0);
        yield* fixture.connectionConnected();
        yield* fixture.openRoomEvents();
        yield* fixture.gatheringComplete();
        yield* fixture.detached();

        yield* fixture.sendLeave();
      }),
    ),
  );

  it.effect('redeclares readiness for a replacement offerer generation', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.receiveAnswer(bob, 'answer-sdp-0', 0);
        yield* fixture.connectionConnected();
        yield* fixture.openRoomEvents();
        yield* fixture.gatheringComplete();
        yield* fixture.receiveDetachProbe();

        yield* fixture.connectionFailed();
        const replacementConnection = fixture.peerConnections[1]!;
        const replacementChannel = fixture.dataChannels[1]!;
        yield* fixture.receiveAnswer(bob, 'answer-sdp-1', 1);
        yield* fixture.connectionConnected(replacementConnection);
        yield* fixture.openRoomEvents(replacementChannel);
        yield* fixture.gatheringComplete(replacementConnection);
        yield* fixture.receiveDetachProbe(replacementChannel);

        assert.deepStrictEqual(fixture.readinessEpochs, [0, 1]);
      }),
    ),
  );

  it.effect('redeclares readiness when an answerer adopts a newer remote epoch', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(null);
        yield* fixture.peerJoined(bob);
        yield* fixture.receiveOffer(bob, 'offer-sdp-0', 0);
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: fixture.localDataChannel,
        });
        yield* fixture.connectionConnected();
        yield* fixture.openRoomEvents();
        yield* fixture.gatheringComplete();
        yield* fixture.receiveDetachProbe();

        yield* fixture.receiveOffer(bob, 'offer-sdp-1', 1);
        yield* fixture.receiveDetachProbe();

        assert.deepStrictEqual(fixture.readinessEpochs, [0, 1]);
        assert.strictEqual(
          fixture.operations.filter(
            (operation) =>
              operation === 'sendDataChannelMessage:{"version":1,"type":"detach-probe"}',
          ).length,
          2,
        );
      }),
    ),
  );
});

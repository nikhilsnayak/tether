import { assert, describe, it } from '@effect/vitest';
import {
  DisplayName,
  JoinPendingEvent,
  JoinRequestedEvent,
  PeerLeftEvent,
} from '@tether/contracts/modules/room';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';

import { type DataChannelHandle, type MediaStreamHandle } from './Model';
import { PlatformError } from './Platform';
import { bob, makePeerSessionTestHarness } from './test/PeerSessionTestHarness';

describe('peer-session actor — room events and commands', () => {
  it.effect('routes typed room events without cross-family mutation', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();

        for (const event of [
          {
            version: 1,
            type: 'avatar-pose',
            sequence: 2,
            x: 1,
            z: -1,
            yaw: 0.5,
            action: 'walk',
          },
          {
            version: 1,
            type: 'avatar-pose',
            sequence: 2,
            x: 4,
            z: 4,
            yaw: 1,
            action: 'idle',
          },
          {
            version: 1,
            type: 'media-state',
            revision: 3,
            cameraOn: false,
            microphoneOn: true,
          },
          {
            version: 1,
            type: 'media-state',
            revision: 3,
            cameraOn: true,
            microphoneOn: false,
          },
          { version: 1, type: 'chat-message', text: 'typed hello' },
        ] as const) {
          yield* fixture.actor({
            _tag: 'DataChannelMessageReceived',
            dataChannel: fixture.localDataChannel,
            data: JSON.stringify(event),
          });
        }
        yield* fixture.actor({
          _tag: 'DataChannelMessageReceived',
          dataChannel: fixture.localDataChannel,
          data: '{malformed',
        });

        assert.deepStrictEqual(
          fixture.events.filter((event) => event._tag === 'RemoteAvatarPoseChanged'),
          [
            {
              _tag: 'RemoteAvatarPoseChanged',
              pose: { sequence: 2, x: 1, z: -1, yaw: 0.5, action: 'walk' },
            },
          ],
        );
        assert.deepStrictEqual(
          fixture.events.filter((event) => event._tag === 'RemoteMediaStateChanged'),
          [
            {
              _tag: 'RemoteMediaStateChanged',
              mediaState: {
                revision: 3,
                cameraOn: false,
                microphoneOn: true,
              },
            },
          ],
        );
        assert.deepStrictEqual(
          fixture.events.filter((event) => event._tag === 'ChatMessageAdded'),
          [
            {
              _tag: 'ChatMessageAdded',
              message: {
                id: 'aaaaaaaaaaaa:peer:0',
                sender: 'peer',
                text: 'typed hello',
              },
            },
          ],
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('sends retained media then the latest pose and resets counters on reconnect', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.actor({
          _tag: 'SendAvatarPose',
          pose: { x: 1, z: 2, yaw: 0, action: 'walk' },
        });
        yield* fixture.actor({
          _tag: 'SendMediaState',
          mediaState: { cameraOn: true, microphoneOn: false },
        });
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();

        const firstGenerationSends = fixture.operations.filter((operation) =>
          operation.startsWith('sendDataChannelMessage:'),
        );
        assert.deepStrictEqual(firstGenerationSends, [
          'sendDataChannelMessage:{"version":1,"type":"media-state","revision":0,"cameraOn":true,"microphoneOn":false}',
          'sendDataChannelMessage:{"version":1,"type":"avatar-pose","sequence":0,"x":1,"z":2,"yaw":0,"action":"walk"}',
        ]);

        yield* fixture.actor({
          _tag: 'PeerConnectionFailed',
          peerConnection: fixture.peerConnection,
        });
        const replacementChannel = fixture.dataChannels[1]!;
        yield* fixture.actor({ _tag: 'DataChannelOpened', dataChannel: replacementChannel });

        const allSends = fixture.operations.filter((operation) =>
          operation.startsWith('sendDataChannelMessage:'),
        );
        assert.deepStrictEqual(allSends.slice(2), firstGenerationSends);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('coalesces backpressured poses and flushes the latest idle snapshot', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let bufferedAmount = 65_536;
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          dataChannelBufferedAmount: () => bufferedAmount,
        });
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.actor({
          _tag: 'SendAvatarPose',
          pose: { x: 1, z: 1, yaw: 0, action: 'walk' },
        });
        yield* fixture.actor({
          _tag: 'SendAvatarPose',
          pose: { x: 2, z: 2, yaw: 0.25, action: 'idle' },
        });
        yield* fixture.actor({ _tag: 'SendMessage', message: 'chat bypasses pose pressure' });
        assert.deepStrictEqual(
          fixture.operations.filter((operation) => operation.startsWith('sendDataChannelMessage:')),
          [
            'sendDataChannelMessage:{"version":1,"type":"chat-message","text":"chat bypasses pose pressure"}',
          ],
        );

        bufferedAmount = 16_384;
        yield* fixture.actor({
          _tag: 'RetryPendingAvatarPose',
          peerConnection: fixture.peerConnection,
          dataChannel: fixture.localDataChannel,
        });
        assert.include(
          fixture.operations,
          'sendDataChannelMessage:{"version":1,"type":"avatar-pose","sequence":0,"x":2,"z":2,"yaw":0.25,"action":"idle"}',
        );

        yield* fixture.actor({
          _tag: 'RetryPendingAvatarPose',
          peerConnection: fixture.peerConnection,
          dataChannel: fixture.localDataChannel,
        });
        yield* TestClock.adjust('100 millis');
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('retries a pending pose while the channel remains backpressured', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let bufferedAmount = 65_536;
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          dataChannelBufferedAmount: () => bufferedAmount,
        });
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.actor({
          _tag: 'SendAvatarPose',
          pose: { x: 1, z: 1, yaw: 0, action: 'walk' },
        });

        bufferedAmount = 32_768;
        yield* fixture.actor({
          _tag: 'RetryPendingAvatarPose',
          peerConnection: fixture.peerConnection,
          dataChannel: fixture.localDataChannel,
        });
        yield* TestClock.adjust('100 millis');

        assert.lengthOf(
          fixture.operations.filter((operation) => operation.startsWith('sendDataChannelMessage:')),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('sends media changes only through the owned open data channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        const unknownDataChannel: DataChannelHandle = { value: { label: 'unknown' } };

        yield* fixture.openRoom(bob);
        yield* fixture.actor({
          _tag: 'SendMediaState',
          mediaState: { cameraOn: false, microphoneOn: false },
        });
        yield* fixture.openRoomEvents();
        yield* fixture.actor({
          _tag: 'SendMediaState',
          mediaState: { cameraOn: true, microphoneOn: false },
        });
        yield* fixture.actor({
          _tag: 'RetryPendingAvatarPose',
          peerConnection: fixture.peerConnection,
          dataChannel: unknownDataChannel,
        });

        assert.includeMembers(fixture.operations, [
          'sendDataChannelMessage:{"version":1,"type":"media-state","revision":0,"cameraOn":false,"microphoneOn":false}',
          'sendDataChannelMessage:{"version":1,"type":"media-state","revision":1,"cameraOn":true,"microphoneOn":false}',
        ]);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('drops invalid local chat without sending or projecting it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.actor({ _tag: 'SendMessage', message: 'x'.repeat(4_001) });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'ChatMessageAdded'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('closes room events when the retained media send fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          sendDataChannelMessage: () =>
            Effect.fail(new PlatformError({ operation: 'send-message', cause: 'closed' })),
          closeDataChannel: () =>
            Effect.fail(new PlatformError({ operation: 'close-data-channel', cause: 'closed' })),
        });
        yield* fixture.actor({
          _tag: 'SendMediaState',
          mediaState: { cameraOn: true, microphoneOn: true },
        });
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();

        assert.include(
          fixture.events.map((event) => event._tag),
          'RoomEventsUnavailable',
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('contains a chat send race and keeps processing inputs', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          sendDataChannelMessage: () =>
            Effect.fail(new PlatformError({ operation: 'send-message', cause: 'closed' })),
        });
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.sendChat('hello peer');
        yield* fixture.actor({ _tag: 'RoomEvent', event: new PeerLeftEvent({ peerId: bob }) });

        assert.includeMembers(
          fixture.events.map((event) => event._tag),
          ['RoomEventsUnavailable', 'PeerDeparted'],
        );
        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'ChatMessageAdded'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('contains a pose send race and marks room events unavailable', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          sendDataChannelMessage: () =>
            Effect.fail(new PlatformError({ operation: 'send-message', cause: 'closed' })),
        });
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.actor({
          _tag: 'SendAvatarPose',
          pose: { x: 0, z: 0, yaw: 0, action: 'idle' },
        });

        assert.includeMembers(
          fixture.events.map((event) => event._tag),
          ['RoomEventsUnavailable'],
        );
        assert.notInclude(
          fixture.events.map((event) => event._tag),
          'SessionFailed',
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a chat message before the room-events channel opens', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
        yield* fixture.actor({
          _tag: 'DataChannelMessageReceived',
          dataChannel: fixture.localDataChannel,
          data: 'too early',
        });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'ChatMessageAdded'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('ignores a non-text room-event payload', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.actor({
          _tag: 'DataChannelMessageReceived',
          dataChannel: fixture.localDataChannel,
          data: new Uint8Array([1, 2, 3]),
        });

        assert.lengthOf(
          fixture.events.filter((event) => event._tag === 'ChatMessageAdded'),
          0,
        );
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('records a remote track on the reserved transceivers without emitting', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        const stream: MediaStreamHandle = { value: { id: 'remote-shared-media' } };

        // Before a peer is known the track is ignored; a matching generation stores it.
        yield* fixture.actor({
          _tag: 'RemoteSharedTrackReceived',
          peerConnection: fixture.peerConnection,
          stream,
        });
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        const eventsBefore = fixture.events.length;
        yield* fixture.actor({
          _tag: 'RemoteSharedTrackReceived',
          peerConnection: fixture.peerConnection,
          stream,
        });

        assert.strictEqual(fixture.events.length, eventsBefore);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('surfaces a join request without touching the connection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        const displayName = DisplayName.make('Bob');

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new JoinRequestedEvent({ peerId: bob, displayName }),
        });

        // The knock only projects to the UI; no peer connection is acquired and
        // no offer/answer negotiation is started.
        assert.deepStrictEqual(fixture.events, [
          { _tag: 'JoinRequestReceived', peerId: bob, displayName },
        ]);
        assert.deepStrictEqual(fixture.operations, []);
        assert.deepStrictEqual(fixture.signals, []);
      }),
    ).pipe(Effect.orDie),
  );

  it.effect('surfaces a pending knock to the joiner', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();

        yield* fixture.actor({
          _tag: 'RoomEvent',
          event: new JoinPendingEvent(),
        });

        assert.deepStrictEqual(fixture.events, [{ _tag: 'JoinPending' }]);
        assert.deepStrictEqual(fixture.operations, []);
      }),
    ).pipe(Effect.orDie),
  );
});

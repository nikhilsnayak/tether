import { assert, describe, it } from '@effect/vitest';
import { RoomTemplateId } from '@tether/contracts/modules/room';
import { Effect } from 'effect';

import type { WatchCapabilities, WatchEvent } from '../watch-along/Model';
import { WATCH_PROTOCOL_VERSION, type WatchMessage } from '../watch-along/Protocol';
import { WatchPlatformError } from '../watch-along/Services';
import type { DataChannelHandle, PeerConnectionHandle } from './Model';
import { PlatformError } from './Platform';
import {
  bob,
  makePeerSessionTestHarness,
  type TestDataChannel,
} from './test/PeerSessionTestHarness';
import { WATCH_CONTROL_CHANNEL_LABEL } from './WatchTransport';

const capabilities: WatchCapabilities = {
  canPresentLocalFile: true,
  canReceiveProgramMedia: true,
  canRenderWatch: true,
  canControlWatch: true,
};

const eventually = Effect.fnUntraced(function* (predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) yield* Effect.yieldNow;
  assert.isTrue(predicate());
});

const openCompatibleWatch = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof makePeerSessionTestHarness>>,
) {
  yield* fixture.openWatchChannel();
  yield* eventually(() =>
    fixture.operations.some(
      (operation) =>
        operation.startsWith('sendDataChannelMessage:') && operation.includes('"type":"hello"'),
    ),
  );
  yield* fixture.receiveWatchMessage({
    version: WATCH_PROTOCOL_VERSION,
    type: 'hello',
    ...capabilities,
  });
  yield* eventually(() =>
    fixture.watchEvents.some(
      (event) => event._tag === 'WatchAvailabilityChanged' && event.available,
    ),
  );
});

const proposalFrom = (operations: ReadonlyArray<string>) => {
  const operation = operations.find((candidate) => candidate.includes('"type":"watch-proposed"'));
  assert.isDefined(operation);
  const message = JSON.parse(operation.slice(operation.indexOf(':') + 1)) as WatchMessage;
  assert.strictEqual(message.type, 'watch-proposed');
  if (message.type !== 'watch-proposed') throw new Error('expected watch proposal');
  return message;
};

describe('peer-session watch supervision', () => {
  it.effect('requires template support and local baseline capabilities', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const web = yield* makePeerSessionTestHarness();
        yield* web.openRoom(bob);
        assert.include(web.operations, 'reserveProgramTransceivers');
        assert.isTrue(
          web.dataChannels.some(
            (channel) => (channel.value as TestDataChannel).label === WATCH_CONTROL_CHANNEL_LABEL,
          ),
        );

        const watcherOnly = yield* makePeerSessionTestHarness(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { capabilities: { canPresentLocalFile: false } },
        );
        yield* watcherOnly.openRoom(bob);
        assert.include(watcherOnly.operations, 'reserveProgramTransceivers');

        for (const capability of [
          'canReceiveProgramMedia',
          'canRenderWatch',
          'canControlWatch',
        ] as const) {
          const disabled = yield* makePeerSessionTestHarness(
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { capabilities: { [capability]: false } },
          );
          yield* disabled.openRoom(bob);
          assert.notInclude(disabled.operations, 'reserveProgramTransceivers');
          assert.isFalse(
            disabled.dataChannels.some(
              (channel) => (channel.value as TestDataChannel).label === WATCH_CONTROL_CHANNEL_LABEL,
            ),
          );
          assert.include(disabled.operations, 'createOffer');
        }

        const unsupportedTemplate = yield* makePeerSessionTestHarness();
        yield* unsupportedTemplate.openRoom(bob, RoomTemplateId.make('watch-disabled-test'));
        assert.notInclude(unsupportedTemplate.operations, 'reserveProgramTransceivers');
        assert.isFalse(
          unsupportedTemplate.dataChannels.some(
            (channel) => (channel.value as TestDataChannel).label === WATCH_CONTROL_CHANNEL_LABEL,
          ),
        );
      }),
    ),
  );

  it.effect('keeps an incapable answerer alive when a peer offers watch', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const disabledAnswerer = yield* makePeerSessionTestHarness(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            role: 'host',
            capabilities: {
              canPresentLocalFile: false,
              canReceiveProgramMedia: false,
              canRenderWatch: false,
              canControlWatch: false,
            },
          },
        );
        const remoteWatchChannel: DataChannelHandle = {
          value: { label: WATCH_CONTROL_CHANNEL_LABEL } satisfies TestDataChannel,
        };

        yield* disabledAnswerer.openRoom(null);
        yield* disabledAnswerer.peerJoined(bob);
        yield* disabledAnswerer.receiveOffer(bob, 'disabled-offer', 0);
        yield* disabledAnswerer.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: disabledAnswerer.peerConnection,
          dataChannel: remoteWatchChannel,
        });
        yield* disabledAnswerer.actor({
          _tag: 'DataChannelOpened',
          dataChannel: remoteWatchChannel,
        });

        assert.notInclude(disabledAnswerer.operations, 'reserveProgramTransceivers');
        assert.include(disabledAnswerer.operations, 'createAnswer');
        assert.include(
          disabledAnswerer.operations,
          `closeDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`,
        );
        assert.isFalse(
          disabledAnswerer.operations.some((operation) => operation.includes('"type":"hello"')),
        );
      }),
    ),
  );

  it.effect('connects a prepared source and forwards shared play', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* openCompatibleWatch(fixture);

        yield* fixture.actor({
          _tag: 'WatchProposeSource',
          source: { _tag: 'PreparedSource', value: { id: 'source' } },
        });
        yield* eventually(() =>
          fixture.operations.some((operation) => operation.includes('"type":"watch-proposed"')),
        );
        const proposal = proposalFrom(fixture.operations);
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ready',
          watchSessionId: proposal.watchSessionId,
        });
        yield* eventually(() => fixture.operations.includes('replaceProgramTracks:set'));

        yield* fixture.actor({ _tag: 'WatchRequestControl', control: { kind: 'play' } });
        yield* eventually(() => fixture.operations.includes('watch:play'));
      }),
    ),
  );

  it.effect('projects the remote stream while watching and clears it when the channel closes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* openCompatibleWatch(fixture);

        const stream = { value: { id: 'remote-program' } };
        yield* fixture.actor({
          _tag: 'RemoteSharedTrackReceived',
          peerConnection: fixture.peerConnection,
          stream,
        });
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-proposed',
          watchSessionId: 'watch-peer-01',
        });
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'playback-state-changed',
          watchSessionId: 'watch-peer-01',
          status: 'loaded-paused',
        });
        yield* eventually(() =>
          fixture.watchEvents.some((event) => event._tag === 'WatchProgramStreamReady'),
        );
        const ready = fixture.watchEvents.find(
          (event): event is Extract<WatchEvent, { _tag: 'WatchProgramStreamReady' }> =>
            event._tag === 'WatchProgramStreamReady',
        );
        assert.deepStrictEqual(ready?.stream, stream);

        yield* fixture.closeWatchChannel();
        yield* eventually(() =>
          fixture.watchEvents.some((event) => event._tag === 'WatchProgramStreamCleared'),
        );
        yield* fixture.sendChat('call survived');
        assert.isTrue(
          fixture.operations.some(
            (operation) =>
              operation.includes('chat-message') && operation.includes('call survived'),
          ),
        );
        yield* fixture.peerLeft(bob);
      }),
    ),
  );

  it.effect('drops invalid watch messages without affecting room chat', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* openCompatibleWatch(fixture);

        yield* fixture.receiveWatchMessage('{malformed');
        yield* fixture.receiveWatchMessage('x'.repeat(100_000));
        yield* fixture.sendChat('still alive');

        assert.isTrue(
          fixture.operations.some(
            (operation) => operation.includes('chat-message') && operation.includes('still alive'),
          ),
        );
      }),
    ),
  );

  it.effect('keeps room events alive after watch transport failure', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sent: string[] = [];
        let failWatch = false;
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          sendDataChannelMessage: (dataChannel, message) => {
            const label = (dataChannel.value as TestDataChannel).label;
            sent.push(`${label}:${message}`);
            return failWatch && label === WATCH_CONTROL_CHANNEL_LABEL
              ? Effect.fail(new PlatformError({ operation: 'send-message', cause: 'failed' }))
              : Effect.void;
          },
        });
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.openWatchChannel();
        yield* eventually(() =>
          sent.some(
            (message) =>
              message.startsWith(`${WATCH_CONTROL_CHANNEL_LABEL}:`) &&
              message.includes('"type":"hello"'),
          ),
        );
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'hello',
          ...capabilities,
        });
        yield* eventually(() =>
          fixture.watchEvents.some(
            (event) => event._tag === 'WatchAvailabilityChanged' && event.available,
          ),
        );
        yield* fixture.actor({
          _tag: 'WatchProposeSource',
          source: { _tag: 'PreparedSource', value: { id: 'source' } },
        });
        yield* eventually(() =>
          sent.some((message) => message.includes('"type":"watch-proposed"')),
        );
        const proposed = sent.find((message) => message.includes('"type":"watch-proposed"'));
        assert.isDefined(proposed);
        const proposal = JSON.parse(proposed.slice(proposed.indexOf(':') + 1)) as WatchMessage;
        assert.strictEqual(proposal.type, 'watch-proposed');
        if (proposal.type !== 'watch-proposed') return;
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ready',
          watchSessionId: proposal.watchSessionId,
        });
        yield* eventually(() => fixture.operations.includes('replaceProgramTracks:set'));

        failWatch = true;
        yield* fixture.actor({ _tag: 'WatchRequestControl', control: { kind: 'play' } });
        yield* eventually(() => fixture.localInputs.length === 1);
        const terminated = fixture.localInputs[0];
        assert.isDefined(terminated);
        assert.strictEqual(terminated.reason, 'actor-failed');
        yield* fixture.actor(terminated);

        yield* fixture.sendChat('call survived watch failure');
        assert.isTrue(
          sent.some(
            (message) =>
              message.startsWith('room-events-v1:') &&
              message.includes('call survived watch failure'),
          ),
        );
        assert.include(fixture.operations, `closeDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`);
      }),
    ),
  );

  it.effect('ends presenter watch once on interruption without ending the call', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.connectionConnected();
        yield* fixture.openRoomEvents();
        yield* openCompatibleWatch(fixture);
        yield* fixture.actor({
          _tag: 'WatchProposeSource',
          source: { _tag: 'PreparedSource', value: { id: 'source' } },
        });
        yield* eventually(() =>
          fixture.operations.some((operation) => operation.includes('"type":"watch-proposed"')),
        );
        const proposal = proposalFrom(fixture.operations);
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ready',
          watchSessionId: proposal.watchSessionId,
        });
        yield* eventually(() => fixture.operations.includes('replaceProgramTracks:set'));

        yield* fixture.connectionInterrupted({ value: { id: 'stale-connection' } });
        assert.strictEqual(fixture.localInputs.length, 0);

        yield* fixture.connectionInterrupted();
        yield* fixture.connectionInterrupted();

        assert.strictEqual(fixture.localInputs.length, 1);
        const terminated = fixture.localInputs[0];
        assert.isDefined(terminated);
        assert.strictEqual(terminated.reason, 'transport-interrupted');
        assert.strictEqual(
          fixture.operations.filter((operation) => operation === 'watch:releaseSource').length,
          1,
        );
        assert.strictEqual(
          fixture.operations.filter((operation) => operation === 'replaceProgramTracks:clear')
            .length,
          1,
        );
        assert.strictEqual(
          fixture.operations.filter(
            (operation) => operation === `closeDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`,
          ).length,
          1,
        );
        assert.isTrue(
          fixture.watchEvents.some(
            (event) => event._tag === 'WatchAvailabilityChanged' && !event.available,
          ),
        );

        yield* fixture.actor(terminated);
        yield* fixture.connectionRestored();
        const helloCount = fixture.operations.filter((operation) =>
          operation.includes('"type":"hello"'),
        ).length;
        yield* fixture.openWatchChannel();
        yield* fixture.actor({
          _tag: 'WatchProposeSource',
          source: { _tag: 'PreparedSource', value: { id: 'after-restore' } },
        });
        assert.strictEqual(
          fixture.operations.filter((operation) => operation.includes('"type":"hello"')).length,
          helloCount,
        );
        assert.include(fixture.operations, 'watch:cancelPreparedSource');

        yield* fixture.sendChat('call survived interruption');
        assert.isTrue(
          fixture.operations.some(
            (operation) =>
              operation.includes('chat-message') &&
              operation.includes('call survived interruption'),
          ),
        );

        yield* fixture.connectionFailed();
        assert.strictEqual(
          fixture.operations.filter(
            (operation) => operation === `createDataChannel:${WATCH_CONTROL_CHANNEL_LABEL}`,
          ).length,
          2,
        );
      }),
    ),
  );

  it.effect('clears watcher playback on interruption while keeping recovery alive', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.connectionConnected();
        yield* openCompatibleWatch(fixture);
        const stream = { value: { id: 'remote-program' } };
        yield* fixture.actor({
          _tag: 'RemoteSharedTrackReceived',
          peerConnection: fixture.peerConnection,
          stream,
        });
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-proposed',
          watchSessionId: 'watch-interrupted',
        });
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'playback-state-changed',
          watchSessionId: 'watch-interrupted',
          status: 'playing',
        });
        yield* eventually(() =>
          fixture.watchEvents.some((event) => event._tag === 'WatchProgramStreamReady'),
        );

        yield* fixture.connectionInterrupted();

        assert.strictEqual(fixture.localInputs[0]?.reason, 'transport-interrupted');
        assert.strictEqual(
          fixture.watchEvents.filter((event) => event._tag === 'WatchProgramStreamCleared').length,
          1,
        );
        yield* fixture.connectionRestored();
        yield* fixture.sendMediaState({ cameraOn: true, microphoneOn: true });
        assert.isTrue(fixture.events.some((event) => event._tag === 'PeerRestored'));
      }),
    ),
  );

  it.effect(
    'activates answerer transceivers and seeds a late watch runtime with remote media',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const roles: string[] = [];
          const activations: string[] = [];
          const fixture = yield* makePeerSessionTestHarness(
            undefined,
            undefined,
            {
              reserveProgramTransceivers: (_peerConnection, role) =>
                Effect.sync(() => {
                  roles.push(role);
                  return { value: {} };
                }),
              activateProgramTransceivers: () =>
                Effect.sync(() => {
                  activations.push('activated');
                }),
            },
            undefined,
            undefined,
            { role: 'host' },
          );
          const watchChannel: DataChannelHandle = {
            value: { label: WATCH_CONTROL_CHANNEL_LABEL } satisfies TestDataChannel,
          };
          const remoteStream = { value: { id: 'remote-before-watch-open' } };

          yield* fixture.openRoom(null);
          yield* fixture.peerJoined(bob);
          yield* fixture.receiveOffer(bob, 'remote-offer', 0);
          assert.deepStrictEqual(roles, ['answerer']);
          assert.deepStrictEqual(activations, ['activated']);

          yield* fixture.actor({
            _tag: 'RemoteDataChannel',
            peerConnection: fixture.peerConnection,
            dataChannel: watchChannel,
          });
          yield* fixture.actor({
            _tag: 'RemoteSharedTrackReceived',
            peerConnection: fixture.peerConnection,
            stream: remoteStream,
          });
          yield* fixture.actor({ _tag: 'DataChannelOpened', dataChannel: watchChannel });
          yield* fixture.actor({ _tag: 'DataChannelOpened', dataChannel: watchChannel });

          yield* fixture.actor({
            _tag: 'WatchRuntimeTerminated',
            peerConnection: { value: { id: 'stale' } } satisfies PeerConnectionHandle,
            reason: 'generation-closed',
          });
          yield* fixture.actor({
            _tag: 'WatchRuntimeTerminated',
            peerConnection: fixture.peerConnection,
            reason: 'generation-closed',
          });
          yield* fixture.actor({ _tag: 'WatchRequestControl', control: { kind: 'play' } });
          yield* fixture.actor({ _tag: 'WatchCancel' });
        }),
      ),
  );

  it.effect('cancels proposals when watch runtime startup is unavailable', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness(
          undefined,
          undefined,
          {
            closeDataChannel: undefined,
            sendDataChannelMessage: () =>
              Effect.fail(new PlatformError({ operation: 'send-message', cause: 'failed' })),
          },
          undefined,
          undefined,
          {
            platform: {
              cancelPreparedSource: () =>
                Effect.fail(
                  new WatchPlatformError({
                    operation: 'cancel-prepared-source',
                    cause: 'failed',
                  }),
                ),
            },
          },
        );

        yield* fixture.actor({
          _tag: 'WatchRuntimeTerminated',
          peerConnection: fixture.peerConnection,
          reason: 'generation-closed',
        });
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.sendChat('close-less failure');
        yield* fixture.openWatchChannel();
        yield* fixture.actor({
          _tag: 'WatchProposeSource',
          source: { _tag: 'PreparedSource', value: { id: 'unclaimed' } },
        });
        yield* fixture.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: fixture.peerConnection,
          dataChannel: { value: { label: 'unexpected' } satisfies TestDataChannel },
        });
      }),
    ),
  );

  it.effect('maps program-track replacement failures into watch platform failures', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          replaceProgramTracks: () =>
            Effect.fail(
              new PlatformError({ operation: 'replace-program-tracks', cause: 'failed' }),
            ),
        });
        yield* fixture.openRoom(bob);
        yield* openCompatibleWatch(fixture);
        yield* fixture.actor({
          _tag: 'WatchProposeSource',
          source: { _tag: 'PreparedSource', value: { id: 'replacement-failure' } },
        });
        yield* eventually(() =>
          fixture.operations.some((operation) => operation.includes('"type":"watch-proposed"')),
        );
        const proposal = proposalFrom(fixture.operations);
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ready',
          watchSessionId: proposal.watchSessionId,
        });
        yield* eventually(() =>
          fixture.watchEvents.some(
            (event) => event._tag === 'WatchFailed' && event.reason === 'source',
          ),
        );
      }),
    ),
  );
});

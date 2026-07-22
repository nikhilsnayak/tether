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
  it.effect('provisions watch resources only for a capable room', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const enabled = yield* makePeerSessionTestHarness();
        yield* enabled.openRoom(bob);
        assert.include(enabled.operations, 'reserveProgramTransceivers');
        assert.isTrue(
          enabled.dataChannels.some(
            (channel) => (channel.value as { readonly label: string }).label === 'watch-control-v1',
          ),
        );

        const disabled = yield* makePeerSessionTestHarness();
        yield* disabled.openRoom(bob, RoomTemplateId.make('watch-disabled-test'));
        assert.notInclude(disabled.operations, 'reserveProgramTransceivers');
        assert.isFalse(
          disabled.dataChannels.some(
            (channel) => (channel.value as { readonly label: string }).label === 'watch-control-v1',
          ),
        );

        const disabledAnswerer = yield* makePeerSessionTestHarness();
        yield* disabledAnswerer.openRoom(null, RoomTemplateId.make('watch-disabled-test'));
        yield* disabledAnswerer.peerJoined(bob);
        yield* disabledAnswerer.receiveOffer(bob, 'disabled-offer', 0);
        assert.include(disabledAnswerer.operations, 'createAnswer');
      }),
    ),
  );

  it.effect('connects a prepared source and forwards shared play', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* openCompatibleWatch(fixture);

        yield* fixture.actor({ _tag: 'WatchProposeSource', source: { value: { id: 'source' } } });
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
          yield* fixture.actor({ _tag: 'WatchCancelPreparing' });
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
          source: { value: { id: 'unclaimed' } },
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
          source: { value: { id: 'replacement-failure' } },
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

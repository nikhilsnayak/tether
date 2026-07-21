import { assert, describe, it } from '@effect/vitest';
import { RoomTemplateId } from '@tether/contracts/modules/room';
import { Effect } from 'effect';

import type { WatchCapabilities, WatchEvent } from '../watch-along/Model';
import { WATCH_PROTOCOL_VERSION, type WatchMessage } from '../watch-along/Protocol';
import { bob, makePeerSessionTestHarness } from './test/PeerSessionTestHarness';

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
});

import { assert, describe, it } from '@effect/vitest';
import { RoomTemplateId } from '@tether/contracts/modules/room';
import { Deferred, Effect, Layer, Stream } from 'effect';

import type { AppSignalingClient } from '../../AppSignalingClient';
import { startPeerSession } from '../room/PeerSessionHost';
import type { WatchCapabilities, WatchEvent } from '../watch-along/Model';
import { WATCH_PROTOCOL_VERSION, WatchSessionId, type WatchMessage } from '../watch-along/Protocol';
import {
  WatchEventSink,
  WatchLocalCapabilities,
  WatchPlatformError,
} from '../watch-along/Services';
import type { DataChannelHandle } from './Model';
import { PlatformError } from './Platform';
import {
  bob,
  makePeerSessionTestHarness,
  openedEvent,
  session,
} from './test/PeerSessionTestHarness';

const capabilities: WatchCapabilities = {
  canPresentLocalFile: true,
  canReceiveProgramMedia: true,
  canRenderWatch: true,
  canControlWatch: true,
};
const watchSessionId = WatchSessionId.make('watch-peer-01');

const eventually = Effect.fnUntraced(function* (predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) {
    yield* Effect.yieldNow;
  }
  assert.isTrue(predicate());
});

const hello: WatchMessage = {
  version: WATCH_PROTOCOL_VERSION,
  type: 'hello',
  ...capabilities,
};

const openCompatibleWatch = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof makePeerSessionTestHarness>>,
) {
  const helloCount = fixture.operations.filter(
    (operation) =>
      operation.startsWith('sendDataChannelMessage:') && operation.includes('"type":"hello"'),
  ).length;
  const availableCount = fixture.watchEvents.filter(
    (event) => event._tag === 'WatchAvailabilityChanged' && event.available,
  ).length;
  yield* fixture.openWatchChannel();
  yield* eventually(
    () =>
      fixture.operations.filter(
        (operation) =>
          operation.startsWith('sendDataChannelMessage:') && operation.includes('"type":"hello"'),
      ).length > helloCount,
  );
  yield* fixture.receiveWatchMessage(hello);
  yield* eventually(
    () =>
      fixture.watchEvents.filter(
        (event) => event._tag === 'WatchAvailabilityChanged' && event.available,
      ).length > availableCount,
  );
});

describe('peer-session watch supervision', () => {
  it.effect('starts watch only for a capable template with an open channel', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const enabled = yield* makePeerSessionTestHarness();
        yield* enabled.openRoom(bob);
        assert.include(enabled.operations, 'reserveProgramTransceivers');
        assert.notInclude(enabled.operations, 'replaceProgramTracks:set');
        assert.isFalse(
          enabled.operations.some(
            (operation) =>
              operation.startsWith('sendDataChannelMessage:') &&
              operation.includes('"type":"hello"'),
          ),
        );

        yield* openCompatibleWatch(enabled);
        yield* enabled.openWatchChannel();
        assert.notInclude(enabled.operations, 'replaceProgramTracks:set');

        yield* enabled.actor({ _tag: 'WatchProposeSource', source: { value: { id: 'source' } } });
        yield* eventually(() =>
          enabled.operations.some((operation) => operation.includes('"type":"watch-proposed"')),
        );
        const proposalOperation = enabled.operations.find((operation) =>
          operation.includes('"type":"watch-proposed"'),
        );
        assert.isDefined(proposalOperation);
        const proposal = JSON.parse(
          proposalOperation.slice(proposalOperation.indexOf(':') + 1),
        ) as WatchMessage;
        assert.strictEqual(proposal.type, 'watch-proposed');
        if (proposal.type !== 'watch-proposed') return;
        yield* enabled.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ready',
          watchSessionId: proposal.watchSessionId,
        });
        yield* eventually(() => enabled.operations.includes('replaceProgramTracks:set'));
        yield* enabled.actor({ _tag: 'WatchRequestControl', control: { kind: 'play' } });
        yield* eventually(() => enabled.operations.includes('watch:play'));
        yield* enabled.advance('500 millis');
        yield* eventually(() =>
          enabled.operations.some((operation) => operation.includes('"type":"progress-sample"')),
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

  it.effect('drops invalid watch data and keeps room chat alive', () =>
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
            (operation) =>
              operation.startsWith('sendDataChannelMessage:') &&
              operation.includes('chat-message') &&
              operation.includes('still alive'),
          ),
        );
      }),
    ),
  );

  it.effect('forwards interruption, restoration, and generation replacement', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        yield* fixture.connectionConnected();
        yield* openCompatibleWatch(fixture);
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-proposed',
          watchSessionId,
        });
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-started',
          watchSessionId,
        });
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'playback-state-changed',
          watchSessionId,
          authorityEpoch: 0,
          revision: 0,
          status: 'playing',
          progress: 0.25,
        });
        yield* eventually(() =>
          fixture.watchEvents.some(
            (event) => event._tag === 'WatchSessionChanged' && event.view.status === 'playing',
          ),
        );

        yield* fixture.connectionInterrupted();
        yield* eventually(() =>
          fixture.watchEvents.some(
            (event) =>
              event._tag === 'WatchSessionChanged' &&
              event.view.status === 'awaiting-recovery-snapshot',
          ),
        );
        yield* fixture.connectionRestored();
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'playback-state-changed',
          watchSessionId,
          authorityEpoch: 1,
          revision: 1,
          status: 'loaded-paused',
          progress: 0.25,
        });
        yield* eventually(() =>
          fixture.watchEvents.some(
            (event) =>
              event._tag === 'WatchSessionChanged' && event.view.status === 'loaded-paused',
          ),
        );

        yield* fixture.connectionFailed();
        yield* eventually(() =>
          fixture.watchEvents.some(
            (event) => event._tag === 'WatchAvailabilityChanged' && !event.available,
          ),
        );
        yield* openCompatibleWatch(fixture);
        assert.deepStrictEqual(
          fixture.watchEvents.flatMap((event) =>
            event._tag === 'WatchAvailabilityChanged' ? [event.available] : [],
          ),
          [true, false, true],
        );
      }),
    ),
  );

  it.effect('projects only a generation-current remote program stream', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness();
        yield* fixture.openRoom(bob);
        const staleStream = { value: { id: 'before-proposal' } };
        yield* fixture.actor({
          _tag: 'RemoteSharedTrackReceived',
          peerConnection: fixture.peerConnection,
          stream: staleStream,
        });
        yield* openCompatibleWatch(fixture);
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-proposed',
          watchSessionId,
        });
        const currentStream = { value: { id: 'after-proposal' } };
        yield* fixture.actor({
          _tag: 'RemoteSharedTrackReceived',
          peerConnection: fixture.peerConnection,
          stream: currentStream,
        });
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-started',
          watchSessionId,
        });
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'playback-state-changed',
          watchSessionId,
          authorityEpoch: 0,
          revision: 0,
          status: 'loaded-paused',
          progress: 0,
        });
        yield* eventually(() =>
          fixture.watchEvents.some((event) => event._tag === 'WatchProgramStreamReady'),
        );

        const ready = fixture.watchEvents.filter(
          (event): event is Extract<WatchEvent, { _tag: 'WatchProgramStreamReady' }> =>
            event._tag === 'WatchProgramStreamReady',
        );
        assert.deepStrictEqual(ready, [
          { _tag: 'WatchProgramStreamReady', stream: { value: currentStream.value } },
        ]);

        yield* fixture.connectionFailed();
        yield* eventually(() =>
          fixture.watchEvents.some((event) => event._tag === 'WatchProgramStreamCleared'),
        );
        assert.strictEqual(
          fixture.watchEvents.filter((event) => event._tag === 'WatchProgramStreamCleared').length,
          1,
        );
      }),
    ),
  );

  it.effect('isolates an actor defect, clears its runtime reference, and keeps chat alive', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const watchEvents: Array<WatchEvent> = [];
        const sink = WatchEventSink.of({
          emit: (event) =>
            event._tag === 'WatchAvailabilityChanged' && event.available
              ? Effect.die('watch-sink-defect')
              : Effect.sync(() => void watchEvents.push(event)),
        });
        const fixture = yield* makePeerSessionTestHarness(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { sink },
        );
        yield* fixture.openRoom(bob);
        yield* fixture.openRoomEvents();
        yield* fixture.openWatchChannel();
        yield* fixture.receiveWatchMessage(hello);
        yield* eventually(() => fixture.localInputs.length === 1);
        yield* fixture.actor(fixture.localInputs[0]!);
        yield* fixture.actor({ _tag: 'WatchRequestControl', control: { kind: 'play' } });
        yield* fixture.sendChat('call survived');

        assert.include(fixture.operations, 'replaceProgramTracks:clear');
        assert.include(fixture.operations, 'closeDataChannel:watch-control-v1');
        assert.isTrue(watchEvents.some((event) => event._tag === 'WatchFailed'));
        assert.isTrue(
          fixture.operations.some(
            (operation) =>
              operation.includes('chat-message') && operation.includes('call survived'),
          ),
        );
      }),
    ),
  );

  it.effect('handles unavailable platform seams and serialized UI ownership commands', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const withoutClose = yield* makePeerSessionTestHarness(undefined, undefined, {
          closeDataChannel: undefined,
          sendDataChannelMessage: () =>
            Effect.fail(new PlatformError({ operation: 'send-message', cause: 'send-failed' })),
        });
        yield* withoutClose.openRoom(bob);
        yield* withoutClose.openRoomEvents();
        yield* withoutClose.sendChat('fails without close support');
        yield* withoutClose.openWatchChannel();
        yield* Effect.yieldNow;
        assert.isFalse(
          withoutClose.operations.some(
            (operation) =>
              operation.startsWith('sendDataChannelMessage:') &&
              operation.includes('"type":"hello"'),
          ),
        );
        yield* withoutClose.closeWatchChannel();

        const prepared = { value: { id: 'not-transferred' } };
        yield* withoutClose.actor({ _tag: 'WatchProposeSource', source: prepared });
        yield* withoutClose.actor({ _tag: 'WatchCancelPreparing' });
        yield* withoutClose.actor({
          _tag: 'WatchLocalPipelineFailed',
          reason: 'renderer',
        });
        assert.strictEqual(
          withoutClose.operations.filter((operation) => operation === 'watch:cancelPreparedSource')
            .length,
          1,
        );

        yield* withoutClose.actor({
          _tag: 'WatchRuntimeTerminated',
          peerConnection: { value: { id: 'stale-generation' } },
          reason: 'actor-failed',
        });

        const waiting = yield* makePeerSessionTestHarness(undefined, undefined, {
          closeDataChannel: undefined,
        });
        yield* waiting.openRoom(null);
        yield* waiting.peerJoined(bob);
        const unexpected: DataChannelHandle = { value: { label: 'unexpected' } };
        yield* waiting.actor({
          _tag: 'RemoteDataChannel',
          peerConnection: waiting.peerConnection,
          dataChannel: unexpected,
        });

        const cancelFailure = yield* makePeerSessionTestHarness(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            platform: {
              cancelPreparedSource: () =>
                Effect.fail(
                  new WatchPlatformError({
                    operation: 'cancel-prepared-source',
                    cause: 'cancel-failed',
                  }),
                ),
            },
          },
        );
        yield* cancelFailure.actor({
          _tag: 'WatchProposeSource',
          source: { value: { id: 'cancel-failure' } },
        });
      }),
    ),
  );

  it.effect('uses zero buffered bytes when the platform omits its backpressure getter', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          dataChannelBufferedAmount: undefined,
        });
        yield* fixture.openRoom(bob);
        yield* openCompatibleWatch(fixture);
        assert.isTrue(fixture.operations.some((operation) => operation.includes('"type":"hello"')));
        yield* fixture.actor({ _tag: 'WatchProposeSource', source: { value: { id: 'source' } } });
        yield* eventually(() =>
          fixture.operations.some((operation) => operation.includes('"type":"watch-proposed"')),
        );
        const proposalOperation = fixture.operations.find((operation) =>
          operation.includes('"type":"watch-proposed"'),
        );
        assert.isDefined(proposalOperation);
        const proposal = JSON.parse(
          proposalOperation.slice(proposalOperation.indexOf(':') + 1),
        ) as WatchMessage;
        assert.strictEqual(proposal.type, 'watch-proposed');
        if (proposal.type !== 'watch-proposed') return;
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ready',
          watchSessionId: proposal.watchSessionId,
        });
        yield* eventually(() => fixture.operations.includes('replaceProgramTracks:set'));
        yield* fixture.actor({ _tag: 'WatchRequestControl', control: { kind: 'play' } });
        yield* eventually(() => fixture.operations.includes('watch:play'));
        yield* fixture.advance('500 millis');
        yield* eventually(() =>
          fixture.operations.some((operation) => operation.includes('"type":"progress-sample"')),
        );
        yield* fixture.closeWatchChannel();
        yield* eventually(() =>
          fixture.watchEvents.some(
            (event) => event._tag === 'WatchAvailabilityChanged' && !event.available,
          ),
        );
      }),
    ),
  );

  it.effect('maps program-track platform failures into isolated watch failures', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePeerSessionTestHarness(undefined, undefined, {
          replaceProgramTracks: () =>
            Effect.fail(
              new PlatformError({
                operation: 'replace-program-tracks',
                cause: 'replace-failed',
              }),
            ),
        });
        yield* fixture.openRoom(bob);
        yield* openCompatibleWatch(fixture);
        yield* fixture.actor({ _tag: 'WatchProposeSource', source: { value: { id: 'source' } } });
        yield* eventually(() =>
          fixture.operations.some((operation) => operation.includes('"type":"watch-proposed"')),
        );
        const proposalOperation = fixture.operations.find((operation) =>
          operation.includes('"type":"watch-proposed"'),
        );
        assert.isDefined(proposalOperation);
        const proposal = JSON.parse(
          proposalOperation.slice(proposalOperation.indexOf(':') + 1),
        ) as WatchMessage;
        assert.strictEqual(proposal.type, 'watch-proposed');
        if (proposal.type !== 'watch-proposed') return;
        yield* fixture.receiveWatchMessage({
          version: WATCH_PROTOCOL_VERSION,
          type: 'watch-ready',
          watchSessionId: proposal.watchSessionId,
        });
        yield* eventually(() =>
          fixture.watchEvents.some(
            (event) => event._tag === 'WatchFailed' && event.reason === 'attachment',
          ),
        );
        yield* fixture.connectionFailed();
        yield* eventually(() => fixture.localInputs.length > 0);
      }),
    ),
  );

  it.effect('advertises optional host capabilities independently from the platform service', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startHosted = Effect.fnUntraced(function* (providedCapabilities?: WatchCapabilities) {
          const offerSent = yield* Deferred.make<void>();
          const fixture = yield* makePeerSessionTestHarness(
            (() =>
              Stream.make({ event: openedEvent(bob) }).pipe(
                Stream.concat(Stream.never),
              )) as AppSignalingClient['Service']['OpenRoomSession'],
            ({ signal }) =>
              signal._tag === '@tether/SessionDescriptionSignal' && signal.type === 'offer'
                ? Deferred.succeed(offerSent, undefined)
                : Effect.void,
          );
          const dependencies =
            providedCapabilities === undefined
              ? fixture.dependencies
              : Layer.merge(
                  fixture.dependencies,
                  Layer.succeed(WatchLocalCapabilities, providedCapabilities),
                );
          yield* startPeerSession(session).pipe(Effect.provide(dependencies));
          yield* Deferred.await(offerSent);
          fixture.dispatchPlatformEvent({
            _tag: 'DataChannelOpened',
            dataChannel: fixture.watchChannel(),
          });
          yield* eventually(() =>
            fixture.operations.some(
              (operation) =>
                operation.startsWith('sendDataChannelMessage:') &&
                operation.includes('"type":"hello"'),
            ),
          );
          const operation = fixture.operations.find(
            (candidate) =>
              candidate.startsWith('sendDataChannelMessage:') &&
              candidate.includes('"type":"hello"'),
          );
          assert.isDefined(operation);
          return JSON.parse(operation.slice(operation.indexOf(':') + 1)) as WatchMessage;
        });

        const absent = yield* startHosted();
        assert.deepStrictEqual(absent, {
          version: WATCH_PROTOCOL_VERSION,
          type: 'hello',
          canPresentLocalFile: false,
          canReceiveProgramMedia: false,
          canRenderWatch: false,
          canControlWatch: false,
        });

        const declared: WatchCapabilities = {
          canPresentLocalFile: false,
          canReceiveProgramMedia: true,
          canRenderWatch: true,
          canControlWatch: true,
        };
        const present = yield* startHosted(declared);
        assert.deepStrictEqual(present, {
          version: WATCH_PROTOCOL_VERSION,
          type: 'hello',
          ...declared,
        });
      }),
    ),
  );
});

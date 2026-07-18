import { assert, describe, it } from '@effect/vitest';
import { Crypto, Effect, Exit, Scope } from 'effect';

import { webCrypto } from '../../test/WebCrypto';
import type { PreparedSourceHandle, WatchCapabilities, WatchEvent } from './Model';
import { WATCH_PROTOCOL_VERSION, type WatchMessage } from './Protocol';
import { WatchAlongPlatform, WatchEventSink, WatchPlatformError } from './Services';
import { startWatchRuntime, WATCH_PROGRESS_BUFFER_HIGH_WATER_BYTES } from './Supervisor';

const capabilities: WatchCapabilities = {
  canPresentLocalFile: true,
  canReceiveProgramMedia: true,
  canRenderWatch: true,
  canControlWatch: true,
};

const eventually = Effect.fnUntraced(function* (predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) {
    yield* Effect.yieldNow;
  }
  assert.isTrue(predicate());
});

const makePlatform = (
  operations: Array<string>,
  currentProgress: () => number = () => 0,
): WatchAlongPlatform['Service'] => ({
  cancelPreparedSource: () => Effect.sync(() => operations.push('cancelPreparedSource')),
  claimSource: () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        operations.push('claimSource');
        return { value: { id: 'claimed' } };
      }),
      () => Effect.sync(() => operations.push('releaseSource')),
    ),
  programStream: () => Effect.succeed({ value: { id: 'program' } }),
  play: () => Effect.sync(() => operations.push('play')),
  pause: () => Effect.sync(() => operations.push('pause')),
  seek: () => Effect.void,
  currentProgress: () => Effect.succeed(currentProgress()),
  observeSource: () => Effect.void,
  primeFirstFrame: () => Effect.void,
  attachProgramTracks: () => Effect.void,
  clearProgramTracks: Effect.void,
});

const withCrypto = <A, E, R>(effect: Effect.Effect<A, E, R | Crypto.Crypto>) =>
  effect.pipe(Effect.provide(webCrypto));

describe('watch runtime supervisor', () => {
  it.effect('retains only the latest progress sample and lets a discrete command overtake it', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: Array<string> = [];
          const events: Array<WatchEvent> = [];
          const sent: Array<WatchMessage> = [];
          let bufferedAmount = 0;
          let progress = 0;
          let failProgressSend = false;
          const platform = makePlatform(operations, () => progress);
          const runtime = yield* startWatchRuntime({
            role: 'host',
            capabilities,
            sendRaw: (payload) =>
              Effect.suspend(() => {
                const message = JSON.parse(payload) as WatchMessage;
                if (failProgressSend && message.type === 'progress-sample') {
                  return Effect.fail('progress-send-failed');
                }
                return Effect.sync(() => {
                  sent.push(message);
                });
              }),
            bufferedAmount: () => bufferedAmount,
            closeWatchChannel: Effect.sync(() => operations.push('closeWatchChannel')),
            attach: () => Effect.sync(() => operations.push('attach')),
            clear: Effect.sync(() => operations.push('clear')),
            platform,
            sink: WatchEventSink.of({
              emit: (event) => Effect.sync(() => void events.push(event)),
            }),
            onTerminated: () => Effect.void,
          });

          assert.isTrue(runtime.dispatch({ _tag: 'ChannelOpened' }));
          yield* eventually(() => sent.some((message) => message.type === 'hello'));
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          yield* eventually(() =>
            events.some((event) => event._tag === 'WatchAvailabilityChanged' && event.available),
          );

          const source: PreparedSourceHandle = { value: { id: 'prepared' } };
          runtime.dispatch({ _tag: 'ProposeLocalSource', source });
          yield* eventually(() => sent.some((message) => message.type === 'watch-proposed'));
          const proposal = sent.find((message) => message.type === 'watch-proposed');
          assert.isDefined(proposal);
          const watchSessionId = proposal.watchSessionId;
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: {
              version: WATCH_PROTOCOL_VERSION,
              type: 'watch-ready',
              watchSessionId,
            },
          });
          yield* eventually(() => operations.includes('attach'));
          runtime.dispatch({ _tag: 'RequestControl', control: { kind: 'play' } });
          yield* eventually(
            () => sent.some((message) => message.type === 'progress-sample') === false,
          );
          yield* eventually(() => operations.includes('play'));

          bufferedAmount = WATCH_PROGRESS_BUFFER_HIGH_WATER_BYTES;
          progress = 0.25;
          runtime.dispatch({ _tag: 'ProgressSampleTick', watchSessionId });
          yield* eventually(() =>
            events.some(
              (event) => event._tag === 'WatchSessionChanged' && event.view.progress === 0.25,
            ),
          );
          progress = 0.75;
          runtime.dispatch({ _tag: 'ProgressSampleTick', watchSessionId });
          yield* eventually(() =>
            events.some(
              (event) => event._tag === 'WatchSessionChanged' && event.view.progress === 0.75,
            ),
          );
          assert.lengthOf(
            sent.filter((message) => message.type === 'progress-sample'),
            0,
          );

          bufferedAmount = 0;
          runtime.dispatch({ _tag: 'RequestControl', control: { kind: 'pause' } });
          yield* eventually(() => sent.some((message) => message.type === 'progress-sample'));
          const tail = sent.slice(-2);
          assert.strictEqual(tail[0]?.type, 'playback-state-changed');
          assert.strictEqual(tail[1]?.type, 'progress-sample');
          if (tail[1]?.type === 'progress-sample') {
            assert.strictEqual(tail[1].progress, 0.75);
          }

          runtime.dispatch({ _tag: 'RequestControl', control: { kind: 'play' } });
          yield* eventually(
            () => operations.filter((operation) => operation === 'play').length === 2,
          );
          failProgressSend = true;
          progress = 0.9;
          runtime.dispatch({ _tag: 'ProgressSampleTick', watchSessionId });
          yield* eventually(() => !runtime.isAlive());
          assert.include(operations, 'closeWatchChannel');
        }),
      ),
    ),
  );

  it.effect('fails closed on an actor defect while notifying termination exactly once', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const parentScope = yield* Scope.Scope;
          const generationScope = yield* Scope.fork(parentScope);
          const operations: Array<string> = [];
          const events: Array<WatchEvent> = [];
          const terminations: Array<string> = [];
          const platform = makePlatform(operations);
          const runtime = yield* startWatchRuntime({
            role: 'guest',
            capabilities,
            sendRaw: () => Effect.void,
            bufferedAmount: () => 0,
            closeWatchChannel: Effect.sync(() => operations.push('closeWatchChannel')),
            attach: () => Effect.void,
            clear: Effect.sync(() => operations.push('clear')),
            platform,
            sink: WatchEventSink.of({
              emit: (event) =>
                event._tag === 'WatchAvailabilityChanged' && event.available
                  ? Effect.die('sink-defect')
                  : Effect.sync(() => void events.push(event)),
            }),
            onTerminated: (reason) =>
              Effect.sync(() => {
                terminations.push(reason);
              }),
          }).pipe(Scope.provide(generationScope));

          runtime.dispatch({ _tag: 'ChannelOpened' });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          yield* eventually(() => !runtime.isAlive());

          assert.deepStrictEqual(terminations, ['actor-failed']);
          assert.include(operations, 'clear');
          assert.include(operations, 'closeWatchChannel');
          assert.isTrue(events.some((event) => event._tag === 'WatchFailed'));
          assert.isFalse(runtime.dispatch({ _tag: 'ChannelClosed' }));

          yield* Scope.close(generationScope, Exit.void);
          assert.deepStrictEqual(terminations, ['actor-failed']);
        }),
      ),
    ),
  );

  it.effect('cancels every queued proposal exactly once on normal generation closure', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const parentScope = yield* Scope.Scope;
          const generationScope = yield* Scope.fork(parentScope);
          const operations: Array<string> = [];
          const terminations: Array<string> = [];
          const runtime = yield* startWatchRuntime({
            role: 'host',
            capabilities,
            sendRaw: () => Effect.void,
            bufferedAmount: () => 0,
            closeWatchChannel: Effect.sync(() => operations.push('closeWatchChannel')),
            attach: () => Effect.void,
            clear: Effect.sync(() => operations.push('clear')),
            platform: makePlatform(operations),
            sink: WatchEventSink.of({ emit: () => Effect.void }),
            onTerminated: (reason) =>
              Effect.sync(() => {
                terminations.push(reason);
              }),
          }).pipe(Scope.provide(generationScope));

          const first = { value: { id: 'first' } };
          const second = { value: { id: 'second' } };
          assert.isTrue(runtime.dispatch({ _tag: 'ProposeLocalSource', source: first }));
          assert.isTrue(runtime.dispatch({ _tag: 'ProposeLocalSource', source: second }));
          yield* Scope.close(generationScope, Exit.void);

          assert.isFalse(runtime.isAlive());
          assert.deepStrictEqual(terminations, ['generation-closed']);
          assert.strictEqual(
            operations.filter((operation) => operation === 'cancelPreparedSource').length,
            2,
          );
          assert.notInclude(operations, 'closeWatchChannel');
        }),
      ),
    ),
  );

  it.effect('continues finalization when every cleanup collaborator fails', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const parentScope = yield* Scope.Scope;
          const generationScope = yield* Scope.fork(parentScope);
          const terminated: Array<string> = [];
          const failure = (operation: string) =>
            Effect.fail(
              new WatchPlatformError({ operation: operation as never, cause: operation }),
            );
          const platform = {
            ...makePlatform([]),
            cancelPreparedSource: () => failure('cancel-prepared-source'),
          };
          const runtime = yield* startWatchRuntime({
            role: 'host',
            capabilities,
            sendRaw: () => Effect.void,
            bufferedAmount: () => 0,
            closeWatchChannel: Effect.die('close-defect'),
            attach: () => Effect.void,
            clear: Effect.die('clear-defect'),
            platform,
            sink: WatchEventSink.of({ emit: () => Effect.die('sink-defect') }),
            onTerminated: (reason) =>
              Effect.sync(() => {
                terminated.push(reason);
              }),
          }).pipe(Scope.provide(generationScope));

          runtime.dispatch({ _tag: 'ChannelOpened' });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          yield* eventually(() => !runtime.isAlive());
          assert.deepStrictEqual(terminated, ['actor-failed']);
        }),
      ),
    ),
  );
});

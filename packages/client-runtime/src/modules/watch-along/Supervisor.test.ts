import { assert, describe, it } from '@effect/vitest';
import { Crypto, Effect, Exit, Scope } from 'effect';

import { webCrypto } from '../../test/WebCrypto';
import type { WatchActorInput } from './ActorModel';
import type { WatchCapabilities, WatchEvent } from './Model';
import { WATCH_PROTOCOL_VERSION, WatchSessionId, type WatchMessage } from './Protocol';
import { WatchAlongPlatform, WatchEventSink } from './Services';
import { startWatchRuntime } from './Supervisor';

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

const platform = (operations: string[]): WatchAlongPlatform['Service'] => ({
  cancelPreparedSource: () => Effect.sync(() => operations.push('cancel')),
  claimSource: () =>
    Effect.acquireRelease(
      Effect.succeed({ _tag: 'ClaimedSource' as const, value: 'claimed' }),
      () => Effect.sync(() => operations.push('release')),
    ),
  programStream: () => Effect.succeed({ value: 'program' }),
  play: () => Effect.sync(() => operations.push('play')),
  pause: () => Effect.sync(() => operations.push('pause')),
  replay: () => Effect.void,
  observeSource: () => Effect.void,
  primeFirstFrame: () => Effect.void,
  attachProgramTracks: () => Effect.void,
  clearProgramTracks: Effect.void,
});

const withCrypto = <A, E, R>(effect: Effect.Effect<A, E, R | Crypto.Crypto>) =>
  effect.pipe(Effect.provide(webCrypto));

describe('watch runtime', () => {
  it.effect('serializes the minimal two-peer flow and cleans up with its generation', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const parent = yield* Scope.Scope;
          const generation = yield* Scope.fork(parent);
          const operations: string[] = [];
          const events: WatchEvent[] = [];
          const sent: WatchMessage[] = [];
          const terminations: string[] = [];
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: (payload) => Effect.sync(() => sent.push(JSON.parse(payload))),
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.sync(() => operations.push('attach')),
            clear: Effect.sync(() => operations.push('clear')),
            platform: platform(operations),
            sink: WatchEventSink.of({
              emit: (event) => Effect.sync(() => void events.push(event)),
            }),
            onTerminated: (reason) => Effect.sync(() => void terminations.push(reason)),
          }).pipe(Scope.provide(generation));

          runtime.dispatch({ _tag: 'ChannelOpened' });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          yield* eventually(() =>
            events.some(
              (event) => event._tag === 'WatchSessionChanged' && event.view.status === 'idle',
            ),
          );
          runtime.dispatch({
            _tag: 'ProposeLocalSource',
            source: { _tag: 'PreparedSource', value: 'prepared' },
          });
          yield* eventually(() => sent.some((message) => message.type === 'watch-proposed'));
          const proposal = sent.find((message) => message.type === 'watch-proposed');
          assert.isDefined(proposal);
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: {
              version: WATCH_PROTOCOL_VERSION,
              type: 'watch-ready',
              watchSessionId: proposal.watchSessionId,
            },
          });
          yield* eventually(() => operations.includes('attach'));
          runtime.dispatch({ _tag: 'RequestControl', control: { kind: 'play' } });
          yield* eventually(() => operations.includes('play'));

          yield* Scope.close(generation, Exit.void);
          assert.isFalse(runtime.isAlive());
          assert.deepStrictEqual(terminations, ['generation-closed']);
          assert.include(operations, 'clear');
          assert.include(operations, 'release');
          assert.notInclude(operations, 'close-channel');
        }),
      ),
    ),
  );

  it.effect('isolates an actor failure by closing only the watch channel', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const events: WatchEvent[] = [];
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: () => Effect.void,
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.void,
            clear: Effect.sync(() => operations.push('clear')),
            platform: platform(operations),
            sink: WatchEventSink.of({
              emit: (event) =>
                event._tag === 'WatchSessionChanged' && event.view.status === 'idle'
                  ? Effect.die('sink-defect')
                  : Effect.sync(() => void events.push(event)),
            }),
            onTerminated: () => Effect.void,
          });
          runtime.dispatch({ _tag: 'ChannelOpened' });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          yield* eventually(() => !runtime.isAlive());
          assert.include(operations, 'close-channel');
          assert.isFalse(runtime.dispatch({ _tag: 'ChannelOpened' }));
        }),
      ),
    ),
  );

  it.effect('shuts down an idle runtime once when transport is interrupted', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const events: WatchEvent[] = [];
          const terminations: string[] = [];
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: () => Effect.void,
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.void,
            clear: Effect.sync(() => operations.push('clear')),
            platform: platform(operations),
            sink: WatchEventSink.of({
              emit: (event) => Effect.sync(() => void events.push(event)),
            }),
            onTerminated: (reason) => Effect.sync(() => void terminations.push(reason)),
          });

          yield* runtime.shutdown('transport-interrupted');
          yield* runtime.shutdown('transport-interrupted');

          assert.isFalse(runtime.isAlive());
          assert.isFalse(runtime.dispatch({ _tag: 'ChannelOpened' }));
          assert.deepStrictEqual(terminations, ['transport-interrupted']);
          assert.strictEqual(operations.filter((operation) => operation === 'clear').length, 1);
          assert.strictEqual(
            operations.filter((operation) => operation === 'close-channel').length,
            1,
          );
        }),
      ),
    ),
  );

  it.effect('cancels a preparing source when transport is interrupted', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const sent: WatchMessage[] = [];
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: (payload) => Effect.sync(() => sent.push(JSON.parse(payload))),
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.void,
            clear: Effect.sync(() => operations.push('clear')),
            platform: platform(operations),
            sink: WatchEventSink.of({ emit: () => Effect.void }),
            onTerminated: () => Effect.void,
          });

          runtime.dispatch({ _tag: 'ChannelOpened' });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          runtime.dispatch({
            _tag: 'ProposeLocalSource',
            source: { _tag: 'PreparedSource', value: 'prepared' },
          });
          yield* eventually(() => sent.some((message) => message.type === 'watch-proposed'));

          yield* runtime.shutdown('transport-interrupted');

          assert.strictEqual(operations.filter((operation) => operation === 'cancel').length, 1);
          assert.strictEqual(
            operations.filter((operation) => operation === 'close-channel').length,
            1,
          );
        }),
      ),
    ),
  );

  it.effect('fails closed at the exact mailbox capacity while idle', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const events: WatchEvent[] = [];
          const cancelled: string[] = [];
          const terminations: string[] = [];
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: () => Effect.void,
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.void,
            clear: Effect.sync(() => operations.push('clear')),
            platform: {
              ...platform(operations),
              cancelPreparedSource: (source) =>
                Effect.sync(() => cancelled.push(source.value as string)),
            },
            sink: WatchEventSink.of({
              emit: (event) => Effect.sync(() => void events.push(event)),
            }),
            onTerminated: (reason) => Effect.sync(() => void terminations.push(reason)),
          });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          yield* eventually(() =>
            events.some(
              (event) => event._tag === 'WatchSessionChanged' && event.view.status === 'idle',
            ),
          );

          for (let index = 0; index < 64; index++) {
            assert.isTrue(runtime.dispatch({ _tag: 'RequestControl', control: { kind: 'play' } }));
          }
          assert.isFalse(
            runtime.dispatch({
              _tag: 'ProposeLocalSource',
              source: { _tag: 'PreparedSource', value: 'rejected' },
            }),
          );
          assert.isFalse(runtime.dispatch({ _tag: 'ChannelOpened' }));

          yield* eventually(() => terminations.length === 1);
          assert.deepStrictEqual(terminations, ['overloaded']);
          assert.deepStrictEqual(cancelled, []);
          assert.strictEqual(
            operations.filter((operation) => operation === 'close-channel').length,
            1,
          );
        }),
      ),
    ),
  );

  it.effect('cancels queued proposals when a suspended actor overloads', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const cancelled: string[] = [];
          const terminations: string[] = [];
          let actorBlocked = false;
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: () =>
              Effect.sync(() => {
                actorBlocked = true;
              }).pipe(Effect.andThen(Effect.never)),
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.void,
            clear: Effect.sync(() => operations.push('clear')),
            platform: {
              ...platform(operations),
              cancelPreparedSource: (source) =>
                Effect.sync(() => cancelled.push(source.value as string)),
            },
            sink: WatchEventSink.of({ emit: () => Effect.void }),
            onTerminated: (reason) => Effect.sync(() => void terminations.push(reason)),
          });
          assert.isTrue(runtime.dispatch({ _tag: 'ChannelOpened' }));
          yield* eventually(() => actorBlocked);

          for (let index = 0; index < 64; index++) {
            assert.isTrue(
              runtime.dispatch({
                _tag: 'ProposeLocalSource',
                source: { _tag: 'PreparedSource', value: `queued-${index}` },
              }),
            );
          }
          assert.isFalse(
            runtime.dispatch({
              _tag: 'ProposeLocalSource',
              source: { _tag: 'PreparedSource', value: 'rejected' },
            }),
          );

          yield* eventually(() => terminations.length === 1);
          assert.strictEqual(cancelled.length, 64);
          assert.isFalse(cancelled.includes('rejected'));
          assert.strictEqual(new Set(cancelled).size, 64);
          assert.deepStrictEqual(terminations, ['overloaded']);
        }),
      ),
    ),
  );

  it.effect('releases an active presenter once when its mailbox overloads', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const events: WatchEvent[] = [];
          const sent: WatchMessage[] = [];
          const terminations: string[] = [];
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: (payload) => Effect.sync(() => sent.push(JSON.parse(payload))),
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.sync(() => operations.push('attach')),
            clear: Effect.sync(() => operations.push('clear')),
            platform: platform(operations),
            sink: WatchEventSink.of({
              emit: (event) => Effect.sync(() => void events.push(event)),
            }),
            onTerminated: (reason) => Effect.sync(() => void terminations.push(reason)),
          });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          yield* eventually(() =>
            events.some(
              (event) => event._tag === 'WatchSessionChanged' && event.view.status === 'idle',
            ),
          );
          runtime.dispatch({
            _tag: 'ProposeLocalSource',
            source: { _tag: 'PreparedSource', value: 'active' },
          });
          yield* eventually(() => sent.some((message) => message.type === 'watch-proposed'));
          const proposal = sent.find((message) => message.type === 'watch-proposed');
          assert.isDefined(proposal);
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: {
              version: WATCH_PROTOCOL_VERSION,
              type: 'watch-ready',
              watchSessionId: proposal.watchSessionId,
            },
          });
          yield* eventually(() => operations.includes('attach'));

          for (let index = 0; index < 64; index++) {
            assert.isTrue(runtime.dispatch({ _tag: 'RequestControl', control: { kind: 'pause' } }));
          }
          assert.isFalse(runtime.dispatch({ _tag: 'RequestControl', control: { kind: 'play' } }));

          yield* eventually(() => terminations.length === 1);
          assert.deepStrictEqual(terminations, ['overloaded']);
          assert.strictEqual(operations.filter((operation) => operation === 'release').length, 1);
          assert.strictEqual(operations.filter((operation) => operation === 'clear').length, 1);
          assert.strictEqual(
            operations.filter((operation) => operation === 'close-channel').length,
            1,
          );
        }),
      ),
    ),
  );

  it.effect('releases presenter and watcher state when transport is interrupted', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const presenterOperations: string[] = [];
          const presenterEvents: WatchEvent[] = [];
          const sent: WatchMessage[] = [];
          const presenter = yield* startWatchRuntime({
            capabilities,
            sendRaw: (payload) => Effect.sync(() => sent.push(JSON.parse(payload))),
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => presenterOperations.push('close-channel')),
            attach: () => Effect.sync(() => presenterOperations.push('attach')),
            clear: Effect.sync(() => presenterOperations.push('clear')),
            platform: platform(presenterOperations),
            sink: WatchEventSink.of({
              emit: (event) => Effect.sync(() => void presenterEvents.push(event)),
            }),
            onTerminated: () => Effect.void,
          });
          presenter.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          presenter.dispatch({
            _tag: 'ProposeLocalSource',
            source: { _tag: 'PreparedSource', value: 'prepared' },
          });
          yield* eventually(() => sent.some((message) => message.type === 'watch-proposed'));
          const proposal = sent.find((message) => message.type === 'watch-proposed');
          assert.isDefined(proposal);
          presenter.dispatch({
            _tag: 'RemoteMessage',
            message: {
              version: WATCH_PROTOCOL_VERSION,
              type: 'watch-ready',
              watchSessionId: proposal.watchSessionId,
            },
          });
          yield* eventually(() => presenterOperations.includes('attach'));

          yield* presenter.shutdown('transport-interrupted');

          assert.strictEqual(
            presenterOperations.filter((operation) => operation === 'release').length,
            1,
          );
          assert.strictEqual(
            presenterOperations.filter((operation) => operation === 'clear').length,
            1,
          );

          const watcherOperations: string[] = [];
          const watcherEvents: WatchEvent[] = [];
          const watcher = yield* startWatchRuntime({
            capabilities,
            sendRaw: () => Effect.void,
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => watcherOperations.push('close-channel')),
            attach: () => Effect.void,
            clear: Effect.sync(() => watcherOperations.push('clear')),
            platform: platform(watcherOperations),
            sink: WatchEventSink.of({
              emit: (event) => Effect.sync(() => void watcherEvents.push(event)),
            }),
            onTerminated: () => Effect.void,
          });
          const watchSessionId = WatchSessionId.make('watcher-session');
          watcher.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          watcher.dispatch({
            _tag: 'RemoteProgramStreamChanged',
            stream: { value: 'remote-program' },
            version: 1,
          });
          watcher.dispatch({
            _tag: 'RemoteMessage',
            message: {
              version: WATCH_PROTOCOL_VERSION,
              type: 'watch-proposed',
              watchSessionId,
            },
          });
          watcher.dispatch({
            _tag: 'RemoteMessage',
            message: {
              version: WATCH_PROTOCOL_VERSION,
              type: 'playback-state-changed',
              watchSessionId,
              status: 'loaded-paused',
            },
          });
          yield* eventually(() =>
            watcherEvents.some((event) => event._tag === 'WatchProgramStreamReady'),
          );

          yield* watcher.shutdown('transport-interrupted');

          assert.strictEqual(
            watcherEvents.filter((event) => event._tag === 'WatchProgramStreamCleared').length,
            1,
          );
          assert.strictEqual(
            watcherOperations.filter((operation) => operation === 'close-channel').length,
            1,
          );
        }),
      ),
    ),
  );

  it.effect('maps transport rejection into an isolated actor failure', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: () => Effect.fail('send-failed'),
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.void,
            clear: Effect.void,
            platform: platform(operations),
            sink: WatchEventSink.of({ emit: () => Effect.void }),
            onTerminated: () => Effect.void,
          });

          runtime.dispatch({ _tag: 'ChannelOpened' });
          yield* eventually(() => !runtime.isAlive());
          assert.include(operations, 'close-channel');
        }),
      ),
    ),
  );

  it.effect('releases an active source once when transport fails', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const events: WatchEvent[] = [];
          const sent: WatchMessage[] = [];
          const terminations: string[] = [];
          let sendBroken = false;
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: (payload) =>
              sendBroken
                ? Effect.fail('send-failed')
                : Effect.sync(() => sent.push(JSON.parse(payload))),
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.sync(() => operations.push('attach')),
            clear: Effect.sync(() => operations.push('clear')),
            platform: platform(operations),
            sink: WatchEventSink.of({
              emit: (event) => Effect.sync(() => void events.push(event)),
            }),
            onTerminated: (reason) => Effect.sync(() => void terminations.push(reason)),
          });

          runtime.dispatch({ _tag: 'ChannelOpened' });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          yield* eventually(() =>
            events.some(
              (event) => event._tag === 'WatchSessionChanged' && event.view.status === 'idle',
            ),
          );
          runtime.dispatch({
            _tag: 'ProposeLocalSource',
            source: { _tag: 'PreparedSource', value: 'prepared' },
          });
          yield* eventually(() => sent.some((message) => message.type === 'watch-proposed'));
          const proposal = sent.find((message) => message.type === 'watch-proposed');
          assert.isDefined(proposal);
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: {
              version: WATCH_PROTOCOL_VERSION,
              type: 'watch-ready',
              watchSessionId: proposal.watchSessionId,
            },
          });
          yield* eventually(() => operations.includes('attach'));

          sendBroken = true;
          runtime.dispatch({ _tag: 'RequestControl', control: { kind: 'play' } });
          yield* eventually(() => !runtime.isAlive());

          assert.deepStrictEqual(terminations, ['actor-failed']);
          assert.strictEqual(operations.filter((operation) => operation === 'release').length, 1);
          assert.strictEqual(operations.filter((operation) => operation === 'clear').length, 1);
          assert.strictEqual(
            operations.filter((operation) => operation === 'close-channel').length,
            1,
          );
        }),
      ),
    ),
  );

  it.effect('fails closed when actor output cannot be encoded', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const watchSessionId = WatchSessionId.make('invalid-output-session');
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: () => Effect.void,
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.void,
            clear: Effect.void,
            platform: platform(operations),
            sink: WatchEventSink.of({ emit: () => Effect.void }),
            onTerminated: () => Effect.void,
          });

          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: { version: WATCH_PROTOCOL_VERSION, type: 'hello', ...capabilities },
          });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: {
              version: WATCH_PROTOCOL_VERSION,
              type: 'watch-proposed',
              watchSessionId,
            },
          });
          runtime.dispatch({
            _tag: 'RemoteMessage',
            message: {
              version: WATCH_PROTOCOL_VERSION,
              type: 'playback-state-changed',
              watchSessionId,
              status: 'playing',
            },
          });
          runtime.dispatch({
            _tag: 'RequestControl',
            control: { kind: 'invalid' },
          } as unknown as WatchActorInput);

          yield* eventually(() => !runtime.isAlive());
          assert.include(operations, 'close-channel');
        }),
      ),
    ),
  );

  it.effect('continues finalization after best-effort cleanup defects', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const parent = yield* Scope.Scope;
          const generation = yield* Scope.fork(parent);
          const terminations: string[] = [];
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: () => Effect.void,
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.die('close-defect'),
            attach: () => Effect.void,
            clear: Effect.die('clear-defect'),
            platform: platform([]),
            sink: WatchEventSink.of({ emit: () => Effect.die('sink-defect') }),
            onTerminated: (reason) => Effect.sync(() => void terminations.push(reason)),
          }).pipe(Scope.provide(generation));

          yield* Scope.close(generation, Exit.void);
          assert.isFalse(runtime.isAlive());
          assert.deepStrictEqual(terminations, ['generation-closed']);
        }),
      ),
    ),
  );

  it.effect('cancels queued proposals dropped during generation shutdown', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const parent = yield* Scope.Scope;
          const generation = yield* Scope.fork(parent);
          const operations: string[] = [];
          const runtime = yield* startWatchRuntime({
            capabilities,
            sendRaw: () => Effect.never,
            sendMediaRaw: () => Effect.void,
            closeWatchChannel: Effect.void,
            attach: () => Effect.void,
            clear: Effect.void,
            platform: platform(operations),
            sink: WatchEventSink.of({ emit: () => Effect.void }),
            onTerminated: () => Effect.void,
          }).pipe(Scope.provide(generation));

          runtime.dispatch({ _tag: 'ChannelOpened' });
          yield* Effect.yieldNow;
          runtime.dispatch({
            _tag: 'ProposeLocalSource',
            source: { _tag: 'PreparedSource', value: 'queued' },
          });
          yield* Scope.close(generation, Exit.void);

          assert.include(operations, 'cancel');
        }),
      ),
    ),
  );
});

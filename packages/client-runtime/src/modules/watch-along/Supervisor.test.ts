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
  seek: () => Effect.void,
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
            role: 'host',
            capabilities,
            sendRaw: (payload) => Effect.sync(() => sent.push(JSON.parse(payload))),
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
            events.some((event) => event._tag === 'WatchAvailabilityChanged' && event.available),
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
            role: 'guest',
            capabilities,
            sendRaw: () => Effect.void,
            closeWatchChannel: Effect.sync(() => operations.push('close-channel')),
            attach: () => Effect.void,
            clear: Effect.sync(() => operations.push('clear')),
            platform: platform(operations),
            sink: WatchEventSink.of({
              emit: (event) =>
                event._tag === 'WatchAvailabilityChanged' && event.available
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
          assert.isTrue(events.some((event) => event._tag === 'WatchFailed'));
          assert.isFalse(runtime.dispatch({ _tag: 'ChannelOpened' }));
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
            role: 'host',
            capabilities,
            sendRaw: () => Effect.fail('send-failed'),
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

  it.effect('fails closed when actor output cannot be encoded', () =>
    Effect.scoped(
      withCrypto(
        Effect.gen(function* () {
          const operations: string[] = [];
          const watchSessionId = WatchSessionId.make('invalid-output-session');
          const runtime = yield* startWatchRuntime({
            role: 'guest',
            capabilities,
            sendRaw: () => Effect.void,
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
            role: 'host',
            capabilities,
            sendRaw: () => Effect.void,
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
            role: 'host',
            capabilities,
            sendRaw: () => Effect.never,
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

import { Effect, Layer, Queue } from 'effect';

import { webCrypto } from '../../../test/WebCrypto';
import type { WatchActorInput, WatchActorInputDispatch, WatchSourceEvent } from '../ActorModel';
import type {
  ClaimedSourceHandle,
  PreparedSourceHandle,
  ProgramStreamHandle,
  WatchCapabilities,
  WatchEvent,
} from '../Model';
import {
  WATCH_PROTOCOL_VERSION,
  type FailureReason,
  type WatchControlCommand,
  type WatchMessage,
  type WatchSessionId,
  type WatchStatus,
} from '../Protocol';
import {
  WatchAlongPlatform,
  WatchEventSink,
  WatchLocalCapabilities,
  WatchTransport,
  WatchTransportError,
} from '../Services';
import { makeWatchActor } from '../WatchActor';

const allCapabilities: WatchCapabilities = {
  canPresentLocalFile: true,
  canReceiveProgramMedia: true,
  canRenderWatch: true,
  canControlWatch: true,
};

export const preparedSource: PreparedSourceHandle = { value: { id: 'prepared' } };
export const claimedSource: ClaimedSourceHandle = { value: { id: 'claimed' } };
export const programStreamHandle: ProgramStreamHandle = { value: { id: 'program' } };
export const remoteStreamHandle: ProgramStreamHandle = { value: { id: 'remote-program' } };

export interface WatchHarnessOptions {
  readonly role?: 'host' | 'guest';
  readonly capabilities?: Partial<WatchCapabilities>;
  readonly overrides?: Partial<WatchAlongPlatform['Service']>;
}

export const hello = (capabilities: WatchCapabilities): WatchMessage => ({
  version: WATCH_PROTOCOL_VERSION,
  type: 'hello',
  ...capabilities,
});

export const makeWatchActorTestHarness = Effect.fn('makeWatchActorTestHarness')(function* (
  options: WatchHarnessOptions = {},
) {
  const role = options.role ?? 'host';
  const capabilities: WatchCapabilities = { ...allCapabilities, ...options.capabilities };

  const operations: Array<string> = [];
  const events: Array<WatchEvent> = [];
  const sent: Array<WatchMessage> = [];
  let sourceDispatch: ((input: WatchSourceEvent) => void) | undefined;

  const basePlatform: WatchAlongPlatform['Service'] = {
    cancelPreparedSource: () => Effect.sync(() => operations.push('cancelPreparedSource')),
    claimSource: () =>
      Effect.acquireRelease(
        Effect.sync(() => {
          operations.push('claimSource');
          return claimedSource;
        }),
        () => Effect.sync(() => operations.push('closeSourceScope')),
      ),
    programStream: () =>
      Effect.sync(() => {
        operations.push('programStream');
        return programStreamHandle;
      }),
    play: () => Effect.sync(() => operations.push('play')),
    pause: () => Effect.sync(() => operations.push('pause')),
    seek: (_source, progress) => Effect.sync(() => operations.push(`seek:${progress}`)),
    observeSource: (_source, dispatch) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          sourceDispatch = dispatch;
          operations.push('observeSource');
        }),
        () => Effect.sync(() => operations.push('unobserveSource')),
      ),
    primeFirstFrame: () => Effect.sync(() => operations.push('primeFirstFrame')),
    attachProgramTracks: () => Effect.sync(() => operations.push('attachProgramTracks')),
    clearProgramTracks: Effect.sync(() => operations.push('clearProgramTracks')),
  };
  const platform = WatchAlongPlatform.of({ ...basePlatform, ...options.overrides });

  let sendBroken = false;
  const transport = WatchTransport.of({
    role,
    sendDiscrete: (message) =>
      sendBroken
        ? Effect.fail(new WatchTransportError({ cause: 'broken' }))
        : Effect.sync(() => {
            sent.push(message);
          }),
  });

  const dependencies = Layer.mergeAll(
    webCrypto,
    Layer.succeed(WatchAlongPlatform, platform),
    Layer.succeed(WatchTransport, transport),
    Layer.succeed(WatchLocalCapabilities, capabilities),
    Layer.succeed(
      WatchEventSink,
      WatchEventSink.of({ emit: (event) => Effect.sync(() => void events.push(event)) }),
    ),
  );

  const mailbox = yield* Queue.unbounded<WatchActorInput>();
  const dispatchInput: WatchActorInputDispatch = (input) => void Queue.offerUnsafe(mailbox, input);

  const actor = yield* makeWatchActor(dispatchInput).pipe(Effect.provide(dependencies));

  // A background fiber serializes the mailbox exactly like the real host. A
  // handler that suspends (e.g. a blocked progress read) simply leaves the fiber
  // parked; `settle` observes the empty, stable queue and returns anyway.
  let processed = 0;
  yield* Effect.forkScoped(
    Effect.forever(
      Queue.take(mailbox).pipe(
        Effect.flatMap(actor.handleInput),
        Effect.ensuring(Effect.sync(() => void processed++)),
      ),
    ),
  );
  const settle = Effect.gen(function* () {
    let last = -1;
    while (Queue.sizeUnsafe(mailbox) > 0 || processed !== last) {
      last = processed;
      yield* Effect.yieldNow;
    }
  });
  const submit = Effect.fnUntraced(function* (input: WatchActorInput) {
    yield* Queue.offer(mailbox, input);
    yield* settle;
  });
  const receive = (message: WatchMessage) => submit({ _tag: 'RemoteMessage', message });

  const canonical = (
    watchSessionId: WatchSessionId,
    fields: {
      readonly status: WatchStatus;
    },
  ): WatchMessage => ({
    version: WATCH_PROTOCOL_VERSION,
    type: 'playback-state-changed',
    watchSessionId,
    status: fields.status,
  });

  return {
    operations,
    events,
    sent,
    dependencies,
    input: submit,
    openChannel: () => submit({ _tag: 'ChannelOpened' }),
    closeChannel: () => submit({ _tag: 'ChannelClosed' }),
    receiveHello: (peer: Partial<WatchCapabilities> = {}) =>
      receive(hello({ ...allCapabilities, ...peer })),
    receive,
    canonical,
    propose: (source: PreparedSourceHandle = preparedSource) =>
      submit({ _tag: 'ProposeLocalSource', source }),
    cancelPreparing: () => submit({ _tag: 'CancelPreparing' }),
    requestControl: (control: WatchControlCommand) => submit({ _tag: 'RequestControl', control }),
    peerProposes: (watchSessionId: WatchSessionId) =>
      receive({ version: WATCH_PROTOCOL_VERSION, type: 'watch-proposed', watchSessionId }),
    receiveReady: (watchSessionId: WatchSessionId) =>
      receive({ version: WATCH_PROTOCOL_VERSION, type: 'watch-ready', watchSessionId }),
    receiveRejected: (watchSessionId: WatchSessionId) =>
      receive({
        version: WATCH_PROTOCOL_VERSION,
        type: 'watch-rejected',
        watchSessionId,
        reason: 'busy',
      }),
    receiveCanonical: (watchSessionId: WatchSessionId, fields: Parameters<typeof canonical>[1]) =>
      receive(canonical(watchSessionId, fields)),
    receiveFailed: (watchSessionId: WatchSessionId, reason: FailureReason) =>
      receive({ version: WATCH_PROTOCOL_VERSION, type: 'watch-failed', watchSessionId, reason }),
    receiveEnded: (watchSessionId: WatchSessionId) =>
      receive({ version: WATCH_PROTOCOL_VERSION, type: 'watch-ended', watchSessionId }),
    remoteStream: (stream: ProgramStreamHandle | null, version: number) =>
      submit({ _tag: 'RemoteProgramStreamChanged', stream, version }),
    sourceEvent: (event: WatchSourceEvent) =>
      Effect.gen(function* () {
        if (sourceDispatch === undefined) throw new Error('Source is not being observed');
        sourceDispatch(event);
        yield* settle;
      }),
    lastSent: () => sent[sent.length - 1],
    breakTransport: () => void (sendBroken = true),
    sessionViews: () =>
      events.flatMap((event) => (event._tag === 'WatchSessionChanged' ? [event.view] : [])),
    lastView: () => {
      const views = events.flatMap((event) =>
        event._tag === 'WatchSessionChanged' ? [event.view] : [],
      );
      return views[views.length - 1];
    },
  };
});

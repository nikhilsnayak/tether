import { Context, Data, type Effect, Predicate, type Scope } from 'effect';

import type { WatchSourceEvent } from './ActorModel';
import type {
  ClaimedSourceHandle,
  PreparedSourceHandle,
  ProgramStreamHandle,
  WatchCapabilities,
  WatchEvent,
} from './Model';
import type { ProgressSample, WatchMessage } from './Protocol';

export type WatchPlatformOperation =
  | 'cancel-prepared-source'
  | 'claim-source'
  | 'program-stream'
  | 'play'
  | 'pause'
  | 'seek'
  | 'current-progress'
  | 'observe-source'
  | 'prime-first-frame'
  | 'attach-program-tracks'
  | 'clear-program-tracks';

export class WatchPlatformError extends Data.TaggedError('WatchPlatformError')<{
  readonly operation: WatchPlatformOperation;
  readonly cause: unknown;
}> {}

export const isWatchPlatformError = (u: unknown): u is WatchPlatformError =>
  Predicate.isTagged(u, 'WatchPlatformError');

export class WatchTransportError extends Data.TaggedError('WatchTransportError')<{
  readonly cause: unknown;
}> {}

/** Platform-neutral local-file playback and program-track operations. */
export class WatchAlongPlatform extends Context.Service<
  WatchAlongPlatform,
  {
    readonly cancelPreparedSource: (
      source: PreparedSourceHandle,
    ) => Effect.Effect<void, WatchPlatformError>;
    readonly claimSource: (
      source: PreparedSourceHandle,
    ) => Effect.Effect<ClaimedSourceHandle, WatchPlatformError, Scope.Scope>;
    readonly programStream: (
      source: ClaimedSourceHandle,
    ) => Effect.Effect<ProgramStreamHandle, WatchPlatformError>;
    readonly play: (source: ClaimedSourceHandle) => Effect.Effect<void, WatchPlatformError>;
    readonly pause: (source: ClaimedSourceHandle) => Effect.Effect<void, WatchPlatformError>;
    readonly seek: (
      source: ClaimedSourceHandle,
      progress: number,
    ) => Effect.Effect<void, WatchPlatformError>;
    readonly currentProgress: (
      source: ClaimedSourceHandle,
    ) => Effect.Effect<number, WatchPlatformError>;
    readonly observeSource: (
      source: ClaimedSourceHandle,
      dispatch: (input: WatchSourceEvent) => void,
    ) => Effect.Effect<void, WatchPlatformError, Scope.Scope>;
    readonly primeFirstFrame: (
      source: ClaimedSourceHandle,
    ) => Effect.Effect<void, WatchPlatformError>;
    readonly attachProgramTracks: (
      stream: ProgramStreamHandle,
    ) => Effect.Effect<void, WatchPlatformError>;
    readonly clearProgramTracks: Effect.Effect<void, WatchPlatformError>;
  }
>()('@tether/client-runtime/watch-along/WatchAlongPlatform') {}

/** Immutable local browser/device capability facts injected at startup. */
export class WatchLocalCapabilities extends Context.Service<
  WatchLocalCapabilities,
  WatchCapabilities
>()('@tether/client-runtime/watch-along/WatchLocalCapabilities') {}

/** Priority-aware `watch-control-v1` channel; exposes arbitration role only. */
export class WatchTransport extends Context.Service<
  WatchTransport,
  {
    readonly role: 'host' | 'guest';
    readonly sendDiscrete: (message: WatchMessage) => Effect.Effect<void, WatchTransportError>;
    readonly offerLatestProgress: (
      message: ProgressSample,
    ) => Effect.Effect<void, WatchTransportError>;
  }
>()('@tether/client-runtime/watch-along/WatchTransport') {}

export class WatchEventSink extends Context.Service<
  WatchEventSink,
  {
    readonly emit: (event: WatchEvent) => Effect.Effect<void, unknown>;
  }
>()('@tether/client-runtime/watch-along/WatchEventSink') {}

import type { Scope } from 'effect';

import type { ClaimedSourceHandle, PreparedSourceHandle, ProgramStreamHandle } from './Model';
import type {
  BufferingReason,
  WatchControlCommand,
  WatchMessage,
  WatchSessionId,
} from './Protocol';

export interface ActiveWatchSessionCommon {
  readonly watchSessionId: WatchSessionId;
  readonly revision: number;
  readonly authorityEpoch: number;
  readonly progress: number;
  readonly interrupted: boolean;
}

export interface PresenterWatchSession extends ActiveWatchSessionCommon {
  readonly role: 'presenter';
  readonly source: ClaimedSourceHandle;
  readonly sourceScope: Scope.Closeable;
}

export interface WatcherWatchSession extends ActiveWatchSessionCommon {
  readonly role: 'watcher';
}

export type ActiveWatchSession = PresenterWatchSession | WatcherWatchSession;

export type WatchActorState =
  | { readonly _tag: 'Unavailable' }
  | { readonly _tag: 'Idle' }
  | {
      readonly _tag: 'PreparingLocal';
      readonly watchSessionId: WatchSessionId;
      readonly preparedSource: PreparedSourceHandle;
    }
  | {
      readonly _tag: 'AwaitingRemoteStart';
      readonly watchSessionId: WatchSessionId;
      readonly started: boolean;
    }
  | { readonly _tag: 'LoadedPaused'; readonly session: ActiveWatchSession }
  | { readonly _tag: 'Playing'; readonly session: ActiveWatchSession }
  | {
      readonly _tag: 'Buffering';
      readonly session: ActiveWatchSession;
      readonly reason: BufferingReason;
    }
  | { readonly _tag: 'Ended'; readonly session: ActiveWatchSession }
  | { readonly _tag: 'AwaitingRecoverySnapshot'; readonly session: WatcherWatchSession };

/** Source lifecycle observations dispatched by `observeSource`. */
export type WatchSourceEvent =
  | { readonly _tag: 'SourceBuffering' }
  | { readonly _tag: 'SourcePlaying' }
  | { readonly _tag: 'SourceEnded' }
  | { readonly _tag: 'SourceFailed' }
  | { readonly _tag: 'SourceProgress'; readonly progress: number }
  | { readonly _tag: 'BackgroundThrottled' }
  | { readonly _tag: 'ForegroundRestored' };

export type WatchActorInput =
  | { readonly _tag: 'RemoteMessage'; readonly message: WatchMessage }
  | { readonly _tag: 'ProposeLocalSource'; readonly source: PreparedSourceHandle }
  | { readonly _tag: 'RequestControl'; readonly control: WatchControlCommand }
  | { readonly _tag: 'CancelPreparing' }
  | WatchSourceEvent
  | { readonly _tag: 'ChannelOpened' }
  | { readonly _tag: 'ChannelClosed' }
  | { readonly _tag: 'TransportInterrupted' }
  | { readonly _tag: 'TransportRestored' }
  | { readonly _tag: 'ProgressSampleTick'; readonly watchSessionId: WatchSessionId }
  | { readonly _tag: 'RestoreDeadlineElapsed'; readonly watchSessionId: WatchSessionId }
  | {
      readonly _tag: 'RemoteProgramStreamChanged';
      readonly stream: ProgramStreamHandle | null;
      readonly version: number;
    }
  | { readonly _tag: 'LocalPipelineFailed'; readonly reason: 'renderer' | 'pipeline' };

export type WatchActorInputDispatch = (input: WatchActorInput) => void;

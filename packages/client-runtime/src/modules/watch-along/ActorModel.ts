import type { PreparedSourceHandle, ProgramStreamHandle } from './Model';
import type { WatchControlCommand, WatchMessage } from './Protocol';

export type WatchSourceEvent =
  | { readonly _tag: 'SourcePlaying' }
  | { readonly _tag: 'SourceEnded' }
  | { readonly _tag: 'SourceFailed' };

export type WatchActorInput =
  | { readonly _tag: 'ChannelOpened' }
  | { readonly _tag: 'ChannelClosed' }
  | { readonly _tag: 'RemoteMessage'; readonly message: WatchMessage }
  | { readonly _tag: 'ProposeLocalSource'; readonly source: PreparedSourceHandle }
  | { readonly _tag: 'RequestControl'; readonly control: WatchControlCommand }
  | { readonly _tag: 'CancelPreparing' }
  | WatchSourceEvent
  | {
      readonly _tag: 'RemoteProgramStreamChanged';
      readonly stream: ProgramStreamHandle | null;
      readonly version: number;
    };

export type WatchActorInputDispatch = (input: WatchActorInput) => void;

export interface PreparedSourceHandle {
  readonly _tag: 'PreparedSource';
  readonly value: unknown;
}

export interface ClaimedSourceHandle {
  readonly _tag: 'ClaimedSource';
  readonly value: unknown;
}

export interface ProgramStreamHandle {
  readonly value: unknown;
}

export interface WatchCapabilities {
  readonly canPresentLocalFile: boolean;
  readonly canReceiveProgramMedia: boolean;
  readonly canRenderWatch: boolean;
  readonly canControlWatch: boolean;
}

export type WatchViewStatus =
  | 'unavailable'
  | 'idle'
  | 'preparing-local'
  | 'awaiting-remote-start'
  | 'loaded-paused'
  | 'playing'
  | 'ended';

export interface WatchSessionView {
  readonly status: WatchViewStatus;
  readonly role: 'presenter' | 'watcher' | null;
  readonly canPresent: boolean;
}

export const initialWatchSessionView: WatchSessionView = {
  status: 'unavailable',
  role: null,
  canPresent: false,
};

export type WatchEvent =
  | { readonly _tag: 'WatchSessionChanged'; readonly view: WatchSessionView }
  | { readonly _tag: 'WatchProgramStreamReady'; readonly stream: ProgramStreamHandle }
  | { readonly _tag: 'WatchProgramStreamCleared' };

import type { BufferingReason, FailureReason } from './Protocol';

/** One-shot provisional ownership token; only `claimSource` promotes it. */
export interface PreparedSourceHandle {
  readonly value: unknown;
}

/** Playback-capable handle produced by claiming a prepared source. */
export interface ClaimedSourceHandle {
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
  | 'buffering'
  | 'ended'
  | 'awaiting-recovery-snapshot';

export interface WatchSessionView {
  readonly status: WatchViewStatus;
  readonly role: 'presenter' | 'watcher' | null;
  readonly progress: number;
  readonly revision: number;
  readonly controlsEnabled: boolean;
  readonly canPresent: boolean;
  readonly bufferingReason: BufferingReason | null;
}

export type WatchEvent =
  | { readonly _tag: 'WatchAvailabilityChanged'; readonly available: boolean }
  | { readonly _tag: 'WatchSessionChanged'; readonly view: WatchSessionView }
  | { readonly _tag: 'WatchProgramStreamReady'; readonly stream: ProgramStreamHandle }
  | { readonly _tag: 'WatchProgramStreamCleared' }
  | { readonly _tag: 'WatchFailed'; readonly reason: FailureReason };

import { Data, Predicate } from 'effect';

import type { IceServer } from './Model';

export const CHAT_CHANNEL_LABEL = 'chat';

export const GOOGLE_STUN_SERVERS: ReadonlyArray<IceServer> = [
  { urls: ['stun:stun.l.google.com:19302'] },
];

export type PlatformOperation =
  | 'acquire-peer-connection'
  | 'acquire-local-media'
  | 'add-local-tracks'
  | 'create-data-channel'
  | 'create-offer'
  | 'create-answer'
  | 'set-local-description'
  | 'set-remote-description'
  | 'add-ice-candidate'
  | 'send-message';

/** Identifies the failed WebRTC step without inspecting its untyped cause. */
export class PlatformError extends Data.TaggedError('PlatformError')<{
  readonly operation: PlatformOperation;
  readonly cause: unknown;
}> {}

export const isPlatformError = (u: unknown): u is PlatformError =>
  Predicate.isTagged(u, 'PlatformError');

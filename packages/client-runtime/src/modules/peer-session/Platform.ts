import { Data, Predicate } from 'effect';

import type { IceServer } from './Model';

/**
 * Product invariant: use STUN only for direct-path discovery. Do not add TURN
 * or any relay fallback; an unreachable direct peer connection must fail.
 */
export const GOOGLE_STUN_SERVERS: ReadonlyArray<IceServer> = [
  { urls: ['stun:stun.l.google.com:19302'] },
];

export type PlatformOperation =
  | 'acquire-peer-connection'
  | 'acquire-local-media'
  | 'add-local-tracks'
  | 'reserve-program-transceivers'
  | 'replace-program-tracks'
  | 'create-data-channel'
  | 'create-offer'
  | 'create-answer'
  | 'set-local-description'
  | 'set-remote-description'
  | 'add-ice-candidate'
  | 'send-message'
  | 'send-binary'
  | 'close-data-channel';

/** Identifies the failed WebRTC step without inspecting its untyped cause. */
export class PlatformError extends Data.TaggedError('PlatformError')<{
  readonly operation: PlatformOperation;
  readonly cause: unknown;
}> {}

export const isPlatformError = (u: unknown): u is PlatformError =>
  Predicate.isTagged(u, 'PlatformError');

import type {
  DisplayName,
  JoinDenied,
  PeerId,
  RoomEvent,
  RoomId,
  RoomTemplateId,
  SessionToken,
} from '@tether/contracts/modules/room';
import type { Deferred, Queue, Stream } from 'effect';

import type { TokenBucket } from '@/lib/TokenBucket';

export type BroadcastRoomEvent = Exclude<RoomEvent, { readonly _tag: '@tether/JoinPendingEvent' }>;

export type Member = {
  readonly peerId: PeerId;
  readonly sessionToken: SessionToken;
  readonly signalBucket: TokenBucket;
  readonly events: Queue.Queue<BroadcastRoomEvent>;
  /** negotiationEpoch this member declared ReadyToDetach for; null until then. */
  readonly detachReadyEpoch: number | null;
};

export type AdmitResult = {
  readonly sessionToken: SessionToken;
  readonly hostPeerId: PeerId;
  readonly events: Queue.Queue<BroadcastRoomEvent>;
  readonly roomTemplateId: RoomTemplateId;
};

export type PendingJoin = {
  readonly peerId: PeerId;
  readonly displayName: DisplayName;
  readonly deferred: Deferred.Deferred<AdmitResult, JoinDenied>;
  readonly events: Queue.Queue<BroadcastRoomEvent>;
};

export type RoomContext = {
  members: Member[];
  pending: PendingJoin[];
  readonly roomTemplateId: RoomTemplateId;
  /** Highest offer epoch the server has relayed; readiness must match it. */
  latestOfferEpoch: number | null;
  /** Set atomically when the second matching readiness arrives. */
  detached: boolean;
};

export type RegistryState = Map<RoomId, RoomContext>;

export type CreateOutcome =
  | { readonly _tag: 'collision' }
  | { readonly _tag: 'rejected' }
  | { readonly _tag: 'created'; readonly events: Stream.Stream<RoomEvent> };

export type JoinOutcome =
  | { readonly _tag: 'not-found' }
  | { readonly _tag: 'already-joined' }
  | { readonly _tag: 'full' }
  | { readonly _tag: 'pending' };

export type RespondAction =
  | { readonly _tag: 'not-member' }
  | { readonly _tag: 'no-pending' }
  | { readonly _tag: 'deny'; readonly deferred: Deferred.Deferred<AdmitResult, JoinDenied> }
  | {
      readonly _tag: 'allow';
      readonly deferred: Deferred.Deferred<AdmitResult, JoinDenied>;
      readonly result: AdmitResult;
    };

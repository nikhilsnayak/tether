import type { ChatMessage } from './Model';
import { MAX_ROOM_EVENT_COUNTER, type AvatarPose, type MediaState } from './RoomEvents';

type CounterState =
  | { readonly _tag: 'Available'; readonly next: number }
  | { readonly _tag: 'Exhausted' };

type Transmission<A> =
  | { readonly _tag: 'NothingToSend' }
  | { readonly _tag: 'CounterExhausted' }
  | { readonly _tag: 'Ready'; readonly counter: number; readonly value: A };

const initialCounter = (): CounterState => ({ _tag: 'Available', next: 0 });

const takeCounter = (state: CounterState): readonly [value: number | null, state: CounterState] => {
  // Reaching exhaustion requires one serialized session generation to emit
  // every one of the 2^31 protocol counters. The boundary itself is covered by
  // takeRoomEventCounter; exercising it through this private state would
  // require billions of transitions.
  /* v8 ignore next 8 */
  if (state._tag === 'Exhausted') return [null, state];
  /* v8 ignore next 3 -- Requires 2^31 transitions in one generation. */
  if (state.next === MAX_ROOM_EVENT_COUNTER) {
    return [state.next, { _tag: 'Exhausted' }];
  }
  return [state.next, { _tag: 'Available', next: state.next + 1 }];
};

const makeChatMemory = (selfId: string) => {
  let nextSequence = 0;

  return {
    nextMessageId: (sender: ChatMessage['sender']) => `${selfId}:${sender}:${nextSequence++}`,
  };
};

type NegotiationMemoryState = {
  readonly nextLocalOfferEpoch: number;
  readonly latestRemoteOfferEpoch: number | null;
};

const makeNegotiationMemory = () => {
  let state: NegotiationMemoryState = {
    nextLocalOfferEpoch: 0,
    latestRemoteOfferEpoch: null,
  };

  return {
    takeLocalOfferEpoch: () => {
      const epoch = state.nextLocalOfferEpoch;
      state = { ...state, nextLocalOfferEpoch: epoch + 1 };
      return epoch;
    },
    acceptRemoteOffer: (epoch: number) => {
      if (state.latestRemoteOfferEpoch !== null && epoch <= state.latestRemoteOfferEpoch) {
        return { _tag: 'Stale', latest: state.latestRemoteOfferEpoch } as const;
      }
      state = { ...state, latestRemoteOfferEpoch: epoch };
      return { _tag: 'Accepted' } as const;
    },
    resetRemoteOffer: () => {
      state = { ...state, latestRemoteOfferEpoch: null };
    },
  };
};

type DetachmentProbeExchange = 'none' | 'sent' | 'received' | 'exchanged';

type DetachmentMemoryState =
  | {
      readonly _tag: 'Attached';
      readonly probeExchange: DetachmentProbeExchange;
      readonly readinessEpoch: number | null;
    }
  | { readonly _tag: 'Detached' };

const makeDetachmentMemory = () => {
  let state: DetachmentMemoryState = {
    _tag: 'Attached',
    probeExchange: 'none',
    readinessEpoch: null,
  };

  return {
    isDetached: () => state._tag === 'Detached',
    markDetached: () => {
      if (state._tag === 'Detached') return false;
      state = { _tag: 'Detached' };
      return true;
    },
    resetGeneration: () => {
      if (state._tag === 'Detached') return;
      state = { _tag: 'Attached', probeExchange: 'none', readinessEpoch: null };
    },
    needsProbe: () =>
      state._tag === 'Attached' &&
      (state.probeExchange === 'none' || state.probeExchange === 'received'),
    markProbeSent: () => {
      if (state._tag === 'Detached') return;
      switch (state.probeExchange) {
        case 'none':
          state = { ...state, probeExchange: 'sent' };
          return;
        case 'received':
          state = { ...state, probeExchange: 'exchanged' };
          return;
        case 'sent':
        case 'exchanged':
          return;
      }
    },
    markProbeReceived: () => {
      if (
        state._tag === 'Detached' ||
        state.probeExchange === 'received' ||
        state.probeExchange === 'exchanged'
      ) {
        return false;
      }
      state = {
        ...state,
        probeExchange: state.probeExchange === 'sent' ? 'exchanged' : 'received',
      };
      return true;
    },
    isProbeExchanged: () => state._tag === 'Attached' && state.probeExchange === 'exchanged',
    hasDeclaredReadiness: () => state._tag === 'Attached' && state.readinessEpoch !== null,
    hasDeclaredReadinessFor: (epoch: number) =>
      state._tag === 'Attached' && state.readinessEpoch === epoch,
    markReadinessSent: (epoch: number) => {
      if (state._tag === 'Detached') return;
      state = { ...state, readinessEpoch: epoch };
    },
  };
};

type AvatarMemoryState =
  | { readonly _tag: 'Empty'; readonly counter: CounterState }
  | {
      readonly _tag: 'Retained';
      readonly counter: CounterState;
      readonly pose: AvatarPose;
      readonly delivery: 'pending' | 'transmitting' | 'sent';
      readonly retry: 'idle' | 'armed';
    };

type RoomEventMemoryState = {
  readonly avatar: AvatarMemoryState;
  readonly media: {
    readonly counter: CounterState;
    readonly latest: MediaState | null;
  };
  readonly remoteOrdering: {
    readonly avatarSequence: number | null;
    readonly mediaRevision: number | null;
  };
};

const makeRoomEventMemory = (initialMediaState: MediaState | null) => {
  let state: RoomEventMemoryState = {
    avatar: { _tag: 'Empty', counter: initialCounter() },
    media: { counter: initialCounter(), latest: initialMediaState },
    remoteOrdering: { avatarSequence: null, mediaRevision: null },
  };

  return {
    resetGeneration: () => {
      state = {
        avatar:
          state.avatar._tag === 'Empty'
            ? { _tag: 'Empty', counter: initialCounter() }
            : {
                _tag: 'Retained',
                counter: initialCounter(),
                pose: state.avatar.pose,
                delivery: 'pending',
                retry: 'idle',
              },
        media: { counter: initialCounter(), latest: state.media.latest },
        remoteOrdering: { avatarSequence: null, mediaRevision: null },
      };
    },
    rememberAvatarPose: (pose: AvatarPose) => {
      state = {
        ...state,
        avatar: {
          _tag: 'Retained',
          counter: state.avatar.counter,
          pose,
          delivery: 'pending',
          retry: state.avatar._tag === 'Retained' ? state.avatar.retry : 'idle',
        },
      };
    },
    latestAvatarPose: () => (state.avatar._tag === 'Retained' ? state.avatar.pose : null),
    hasPendingAvatarPose: () =>
      state.avatar._tag === 'Retained' && state.avatar.delivery === 'pending',
    nextAvatarTransmission: (): Transmission<AvatarPose> => {
      if (state.avatar._tag === 'Empty' || state.avatar.delivery !== 'pending') {
        return { _tag: 'NothingToSend' };
      }
      const [sequence, counter] = takeCounter(state.avatar.counter);
      /* v8 ignore next -- See takeCounter: protocol-lifetime exhaustion. */
      if (sequence === null) return { _tag: 'CounterExhausted' };
      const pose = state.avatar.pose;
      state = {
        ...state,
        avatar: { ...state.avatar, counter, delivery: 'transmitting' },
      };
      return { _tag: 'Ready', counter: sequence, value: pose };
    },
    markAvatarPoseSent: () => {
      /* v8 ignore next -- Only called after nextAvatarTransmission returns Ready. */
      if (state.avatar._tag === 'Empty' || state.avatar.delivery !== 'transmitting') return;
      state = { ...state, avatar: { ...state.avatar, delivery: 'sent' } };
    },
    rememberMediaState: (mediaState: MediaState) => {
      state = { ...state, media: { ...state.media, latest: mediaState } };
    },
    latestMediaState: () => state.media.latest,
    nextMediaTransmission: (): Transmission<MediaState> => {
      if (state.media.latest === null) return { _tag: 'NothingToSend' };
      const [revision, counter] = takeCounter(state.media.counter);
      /* v8 ignore next -- See takeCounter: protocol-lifetime exhaustion. */
      if (revision === null) return { _tag: 'CounterExhausted' };
      const mediaState = state.media.latest;
      state = { ...state, media: { ...state.media, counter } };
      return { _tag: 'Ready', counter: revision, value: mediaState };
    },
    acceptRemoteAvatarSequence: (sequence: number) => {
      const latest = state.remoteOrdering.avatarSequence;
      if (latest !== null && sequence <= latest) return false;
      state = {
        ...state,
        remoteOrdering: { ...state.remoteOrdering, avatarSequence: sequence },
      };
      return true;
    },
    acceptRemoteMediaRevision: (revision: number) => {
      const latest = state.remoteOrdering.mediaRevision;
      if (latest !== null && revision <= latest) return false;
      state = {
        ...state,
        remoteOrdering: { ...state.remoteOrdering, mediaRevision: revision },
      };
      return true;
    },
    isAvatarRetryArmed: () => state.avatar._tag === 'Retained' && state.avatar.retry === 'armed',
    armAvatarRetry: () => {
      if (state.avatar._tag === 'Empty' || state.avatar.delivery === 'sent') return;
      state = { ...state, avatar: { ...state.avatar, retry: 'armed' } };
    },
    disarmAvatarRetry: () => {
      if (state.avatar._tag === 'Empty') return;
      state = { ...state, avatar: { ...state.avatar, retry: 'idle' } };
    },
  };
};

/**
 * Mutable protocol bookkeeping owned by one serialized peer-session actor.
 * Dependent room-event fields are represented as discriminated states and
 * updated only through transitions that preserve their invariants.
 */
export const makePeerSessionMemory = (
  selfId: string,
  initialMediaState: MediaState | null = null,
) => ({
  chat: makeChatMemory(selfId),
  detachment: makeDetachmentMemory(),
  negotiation: makeNegotiationMemory(),
  roomEvents: makeRoomEventMemory(initialMediaState),
});

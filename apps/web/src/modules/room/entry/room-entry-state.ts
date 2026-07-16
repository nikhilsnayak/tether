import type { PreparedMediaSelection } from '../preflight/media';

export type RoomEntryState =
  | { readonly _tag: 'MediaSetup' }
  | { readonly _tag: 'SessionRequested'; readonly preparedMedia: PreparedMediaSelection };

export type RoomEntryEvent =
  | { readonly _tag: 'MediaPrepared'; readonly preparedMedia: PreparedMediaSelection }
  | { readonly _tag: 'RestartMediaSetup' };

export const initialRoomEntryState: RoomEntryState = { _tag: 'MediaSetup' };

export function roomEntryReducer(state: RoomEntryState, event: RoomEntryEvent): RoomEntryState {
  switch (event._tag) {
    case 'MediaPrepared':
      // Prepared media is a linear resource claimed exactly once. A second
      // preparation must not silently replace the first; the dispatch site
      // releases any selection that loses this transition race.
      return state._tag === 'MediaSetup'
        ? { _tag: 'SessionRequested', preparedMedia: event.preparedMedia }
        : state;
    case 'RestartMediaSetup':
      return initialRoomEntryState;
  }
}

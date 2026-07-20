import type { AvatarPose } from '@tether/client-runtime/modules/peer-session';

import type { RoomTemplate } from '../templates/registry';

export interface ConsoleFocusState {
  readonly inRange: boolean;
  readonly focused: boolean;
  readonly tilesVisible: boolean;
}

export type ConsoleFocusEvent =
  | { readonly _tag: 'RangeChanged'; readonly inRange: boolean }
  | { readonly _tag: 'Enter' }
  | { readonly _tag: 'Exit' }
  | { readonly _tag: 'RevealTiles' };

export const initialConsoleFocusState: ConsoleFocusState = {
  inRange: false,
  focused: false,
  tilesVisible: true,
};

export const canEnterConsoleFocus = (
  avatar: Pick<AvatarPose, 'x' | 'z'>,
  anchor: NonNullable<RoomTemplate['watchAlong']>['console'],
): boolean =>
  Math.hypot(avatar.x - anchor.position[0], avatar.z - anchor.position[2]) <=
  anchor.interactionRadius;

export const reduceConsoleFocus = (
  state: ConsoleFocusState,
  event: ConsoleFocusEvent,
): ConsoleFocusState => {
  switch (event._tag) {
    case 'RangeChanged':
      return event.inRange === state.inRange ? state : { ...state, inRange: event.inRange };
    case 'Enter':
      return state.inRange && !state.focused
        ? { ...state, focused: true, tilesVisible: false }
        : state;
    case 'Exit':
      return state.focused || !state.tilesVisible
        ? { ...state, focused: false, tilesVisible: true }
        : state;
    case 'RevealTiles':
      return state.focused && !state.tilesVisible ? { ...state, tilesVisible: true } : state;
  }
};

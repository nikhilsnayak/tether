import { createContext, use, useReducer, type Dispatch, type ReactNode } from 'react';

import {
  initialConsoleFocusState,
  reduceConsoleFocus,
  type ConsoleFocusEvent,
  type ConsoleFocusState,
} from './console-focus';

interface ConsoleFocusContextValue extends ConsoleFocusState {
  readonly dispatch: Dispatch<ConsoleFocusEvent>;
}

const ConsoleFocusContext = createContext<ConsoleFocusContextValue | null>(null);

export function useConsoleFocus(): ConsoleFocusContextValue {
  const value = use(ConsoleFocusContext);
  if (value === null) throw new Error('useConsoleFocus must be used within ConsoleFocusProvider');
  return value;
}

export function ConsoleFocusProvider({ children }: { readonly children: ReactNode }) {
  const [focus, dispatch] = useReducer(reduceConsoleFocus, initialConsoleFocusState);
  return <ConsoleFocusContext value={{ ...focus, dispatch }}>{children}</ConsoleFocusContext>;
}

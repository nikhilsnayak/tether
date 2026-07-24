import { useRef, type RefObject } from 'react';

// useRef(new Thing()) rebuilds and discards the value on every render. This
// constructs it once, on first render, and returns a stable ref afterwards.
export function useLazyRef<T>(create: () => T): RefObject<T> {
  const ref = useRef<T | null>(null);
  if (ref.current === null) ref.current = create();
  return ref as RefObject<T>;
}

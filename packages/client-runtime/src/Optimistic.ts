const OPTIMISTIC_ID_PREFIX = 'optimistic:';

let seq = 0;

/**
 * A client-only id for an optimistic row that has not been persisted yet.
 * Never send this to the server — it is replaced by the real id on refresh.
 */
export const optimisticId = (): string =>
  `${OPTIMISTIC_ID_PREFIX}${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2)}`;

export const isOptimisticId = (id: string): boolean => id.startsWith(OPTIMISTIC_ID_PREFIX);

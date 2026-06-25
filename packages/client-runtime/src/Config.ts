import { Atom } from 'effect/unstable/reactivity';

/**
 * Base URL of the server's RPC endpoint.
 */
export const serverUrlAtom = Atom.make('http://localhost:8008');

import { makeAppClientRuntime } from '@tether/client-runtime';

const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'wss://tether-server.nikhilsnayak.dev/rpc';

const appClientRuntime = makeAppClientRuntime(serverUrl);

export const appClientLayer = appClientRuntime.layer;
export const AppAtomClient = appClientRuntime.AtomClient;

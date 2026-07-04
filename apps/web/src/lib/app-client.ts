import { AppClient } from '@tether/client-runtime';

const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'wss://tether-server.nikhilsnayak.dev/rpc';

export const appClientLayer = AppClient.layer(serverUrl);

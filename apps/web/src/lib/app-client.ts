import { AppClient } from '@tether/client-runtime';

const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:8008/rpc';

export const appClientLayer = AppClient.layer(serverUrl);

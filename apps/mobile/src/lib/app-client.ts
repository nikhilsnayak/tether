import { AppClient } from '@tether/client-runtime';

const serverUrl = process.env.EXPO_PUBLIC_SERVER_URL ?? 'wss://tether-server.nikhilsnayak.dev/rpc';

export const appClientLayer = AppClient.layer(serverUrl);

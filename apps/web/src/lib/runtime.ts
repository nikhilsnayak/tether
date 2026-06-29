import { AppClient } from '@tether/client-runtime';
import { ManagedRuntime } from 'effect';

const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:8008/rpc';

export const appRuntime = ManagedRuntime.make(AppClient.layer(serverUrl));

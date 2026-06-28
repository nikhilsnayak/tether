import { AppClient } from '@tether/client-runtime';
import { ManagedRuntime } from 'effect';

const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8008';

export const appRuntime = ManagedRuntime.make(AppClient.layer(serverUrl));

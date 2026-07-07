import type { BrowserContextOptions } from '@playwright/test';

// Pre-accept the disclaimer gate (see apps/web DisclaimerGate) so specs land
// directly on the app. Shared by the Playwright config's default context and
// every manually created context.
export const seededStorageState: BrowserContextOptions['storageState'] = {
  cookies: [],
  origins: [
    {
      origin: 'http://localhost:5173',
      localStorage: [{ name: 'tether:disclaimer-accepted:v1', value: 'true' }],
    },
  ],
};

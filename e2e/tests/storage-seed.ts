import type { BrowserContextOptions } from '@playwright/test';

const webPort = process.env.TETHER_E2E_WEB_PORT ?? '5173';

// Pre-accept the disclaimer gate (see apps/web DisclaimerGate) and pin low room
// quality so specs land directly on the app. Shared by the Playwright config's
// default context and every manually created context.
export const seededStorageState: BrowserContextOptions['storageState'] = {
  cookies: [],
  origins: [
    {
      origin: `http://localhost:${webPort}`,
      localStorage: [
        { name: 'tether:disclaimer-accepted:v1', value: 'true' },
        { name: 'tether.room.quality', value: 'low' },
      ],
    },
  ],
};

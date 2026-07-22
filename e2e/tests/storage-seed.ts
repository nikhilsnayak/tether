import type { BrowserContextOptions } from '@playwright/test';

type QualityPreference = 'high' | 'low';
const webPort = process.env.TETHER_E2E_WEB_PORT ?? '5173';

const buildStorageState = (
  qualityPreference?: QualityPreference,
): BrowserContextOptions['storageState'] => ({
  cookies: [],
  origins: [
    {
      origin: `http://localhost:${webPort}`,
      localStorage: [
        { name: 'tether:disclaimer-accepted:v1', value: 'true' },
        ...(qualityPreference === undefined
          ? []
          : [{ name: 'tether.room.quality', value: qualityPreference }]),
      ],
    },
  ],
});

// Pre-accept the disclaimer gate (see apps/web DisclaimerGate) so specs land
// directly on the app. Shared by the Playwright config's default context and
// every manually created context.
export const seededStorageState = buildStorageState('low');

export const highQualityStorageState = buildStorageState('high');

export const automaticQualityStorageState = buildStorageState();

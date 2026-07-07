import { defineConfig, devices } from '@playwright/test';

import { seededStorageState } from './tests/storage-seed';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: 'html',
  // Media-heavy specs run concurrently on one machine; the default 5s expect
  // timeout flakes on navigation and status transitions under that load.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:5173`,
    trace: 'on-first-retry',
    storageState: seededStorageState,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'bun run start',
      cwd: '../apps/server',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      url: `http://localhost:8008/health`,
      reuseExistingServer: !CI,
      stdout: 'pipe',
    },
    {
      command: `bun run dev`,
      cwd: '../apps/web',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      env: {
        VITE_SERVER_URL: `ws://localhost:8008/rpc`,
      },
      url: `http://localhost:5173`,
      reuseExistingServer: !CI,
      stdout: 'pipe',
    },
  ],
});

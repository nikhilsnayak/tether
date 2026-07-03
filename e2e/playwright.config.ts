import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
const SERVER_PORT = 8018;
const WEB_PORT = 5183;

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
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
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
      env: {
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        PORT: String(SERVER_PORT),
        TURN_CREDENTIAL: 'e2e-turn-password',
        TURN_URL: 'turn:127.0.0.1:9?transport=udp',
        TURN_USERNAME: 'e2e-turn-user',
      },
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: `bun run dev -- --port ${WEB_PORT}`,
      cwd: '../apps/web',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      env: {
        VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}/rpc`,
      },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';

import { seededStorageState } from './tests/storage-seed';

const CI = !!process.env.CI;
const serverPort = Number(process.env.TETHER_E2E_SERVER_PORT ?? 8008);
const webPort = Number(process.env.TETHER_E2E_WEB_PORT ?? 5173);
const fakeMediaArgs = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
// The core journey renders the real Dusk Suite scene. GitHub-hosted runners use
// Chromium's bundled SwiftShader; local runs retain Vulkan fidelity.
const gpuArgs = CI
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--enable-features=Vulkan', '--enable-unsafe-webgpu', '--use-angle=vulkan'];

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: CI,
  workers: 1,
  timeout: 90_000,
  outputDir: 'test-results',
  reporter: CI ? [['line'], ['html', { open: 'never' }]] : 'html',
  // The two-peer journey runs a lot of media and status transitions on one
  // machine; the default 5s expect timeout flakes under that load.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${webPort}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'off',
    storageState: seededStorageState,
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: [...gpuArgs, ...fakeMediaArgs],
    },
  },
  retries: CI ? 1 : 0,
  webServer: [
    {
      command: 'bun run start',
      cwd: '../apps/server',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      env: { PORT: String(serverPort) },
      url: `http://localhost:${serverPort}/health`,
      reuseExistingServer: !CI,
      stdout: 'pipe',
    },
    {
      command: `bun run dev -- --port ${webPort}`,
      cwd: '../apps/web',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      env: {
        VITE_SERVER_URL: `http://localhost:${serverPort}`,
      },
      url: `http://localhost:${webPort}`,
      reuseExistingServer: !CI,
      stdout: 'pipe',
    },
  ],
});

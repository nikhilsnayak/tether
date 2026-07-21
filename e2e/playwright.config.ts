import { defineConfig, devices } from '@playwright/test';

import { seededStorageState } from './tests/storage-seed';

const CI = !!process.env.CI;
const serverPort = Number(process.env.TETHER_E2E_SERVER_PORT ?? 8008);
const webPort = Number(process.env.TETHER_E2E_WEB_PORT ?? 5173);
const fakeMediaArgs = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
const gpuArgs = CI
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--enable-features=Vulkan', '--enable-unsafe-webgpu', '--use-angle=vulkan'];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI,
  workers: 2,
  timeout: 60_000,
  outputDir: 'test-results',
  reporter: CI
    ? [['line'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : 'html',
  // Media-heavy specs run concurrently on one machine; the default 5s expect
  // timeout flakes on navigation and status transitions under that load.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${webPort}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'off',
    storageState: seededStorageState,
  },
  projects: [
    {
      name: 'fast-browser',
      grepInvert: /@gpu/,
      retries: CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: fakeMediaArgs,
        },
      },
    },
    {
      name: 'gpu-e2e',
      grep: /@gpu/,
      // Production-low quality reduces local graphics contention. CI keeps one
      // diagnostic retry so intermittent failures produce a trace.
      retries: CI ? 1 : 0,
      timeout: 90_000,
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // The Dusk Suite scene needs WebGL2. GitHub-hosted runners use
          // Chromium's bundled SwiftShader; local runs retain Vulkan fidelity.
          args: [...gpuArgs, ...fakeMediaArgs],
        },
      },
    },
  ],
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

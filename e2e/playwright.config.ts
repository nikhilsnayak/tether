import { defineConfig, devices } from '@playwright/test';

import { seededStorageState } from './tests/storage-seed';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  // Each active call owns a Three.js renderer. Keep local concurrency bounded so
  // Vulkan initialization and fake WebRTC devices do not starve one another.
  workers: CI ? 1 : 2,
  timeout: 60_000,
  outputDir: 'test-results',
  reporter: CI
    ? [['line'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : 'html',
  // Media-heavy specs run concurrently on one machine; the default 5s expect
  // timeout flakes on navigation and status transitions under that load.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:5173`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    storageState: seededStorageState,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // The Dusk Suite scene needs a WebGL2 context. Locally we use the
            // hardware ANGLE/Vulkan backend for fidelity, but GitHub-hosted
            // runners have no GPU and no system Vulkan driver, so there we force
            // Chromium's bundled SwiftShader — otherwise WebGL2 is unavailable
            // and every room spec times out at the capability gate.
            ...(CI
              ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
              : ['--enable-features=Vulkan', '--enable-unsafe-webgpu', '--use-angle=vulkan']),
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
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

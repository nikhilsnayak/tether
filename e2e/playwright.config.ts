import { defineConfig, devices } from '@playwright/test';

import { seededStorageState } from './tests/storage-seed';

const CI = !!process.env.CI;
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
    baseURL: `http://localhost:5173`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
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
      // Real WebRTC + WebGPU specs running serially for ~10 minutes contend for
      // CPU/GPU on a single machine even locally, so tolerate retries there too.
      retries: 2,
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

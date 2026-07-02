import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
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
      url: 'http://localhost:8008/health',
      reuseExistingServer: !CI,
      stdout: 'pipe',
    },
    {
      command: 'bun run dev',
      cwd: '../apps/web',
      url: 'http://localhost:5173',
      reuseExistingServer: !CI,
      stdout: 'pipe',
    },
  ],
});

import { expect, test } from '@playwright/test';

import { connectPeers, requireBaseURL } from './helpers';

test('a dropped connection surfaces the failed screen and returns to setup', async ({
  browser,
}, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { host, cleanup } = await connectPeers(browser, baseURL);
  try {
    await host.context().setOffline(true);
    await expect(host.getByText('Session failed', { exact: true }).first()).toBeVisible({
      timeout: 25_000,
    });

    await host.context().setOffline(false);
    await host.getByRole('button', { name: 'Back to room setup' }).click();
    await expect(host).toHaveURL('/');
  } finally {
    await cleanup();
  }
});

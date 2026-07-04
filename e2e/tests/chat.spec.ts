import { expect, test } from '@playwright/test';

import { connectPeers, continueInBrowser, requireBaseURL } from './helpers';

test('message input is disabled until a peer connects', async ({ page }) => {
  await page.goto('/room/chat-gate');
  await continueInBrowser(page);
  await expect(page.getByText('Share this room to invite someone.')).toBeVisible();

  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByText('No messages yet. Say hello once you are connected.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

test('unread indicator shows for messages received while the chat is closed', async ({
  browser,
}, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { host, guest, cleanup } = await connectPeers(browser, baseURL);
  try {
    await expect(host.getByRole('button', { name: 'Open chat', exact: true })).toBeVisible();

    await guest.getByRole('button', { name: 'Open chat' }).click();
    const message = 'ping while the host chat is closed';
    const input = guest.getByRole('textbox', { name: 'Message' });
    await input.fill(message);
    await input.press('Enter');

    await expect(host.getByRole('button', { name: 'Open chat (unread messages)' })).toBeVisible();

    await host.getByRole('button', { name: 'Open chat (unread messages)' }).click();
    await expect(
      host.getByRole('list', { name: 'Chat messages' }).getByText(message),
    ).toBeVisible();
    await host.getByRole('button', { name: 'Close' }).click();

    await expect(host.getByRole('button', { name: 'Open chat', exact: true })).toBeVisible();
    await expect(host.getByRole('button', { name: 'Open chat (unread messages)' })).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('only the message list scrolls when chat content exceeds the viewport', async ({
  browser,
}, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { host, guest, cleanup } = await connectPeers(browser, baseURL);
  try {
    await host.getByRole('button', { name: 'Open chat' }).click();
    await guest.getByRole('button', { name: 'Open chat' }).click();

    const input = guest.getByRole('textbox', { name: 'Message' });
    for (let index = 0; index < 24; index += 1) {
      await input.fill(`overflow message ${index}`);
      await input.press('Enter');
    }

    await expect(host.getByText('overflow message 23')).toBeVisible();

    const viewport = host.locator('[data-slot="scroll-area-viewport"]');
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    const scrollbar = host.locator('[data-slot="scroll-area-scrollbar"]');
    const thumb = host.locator('[data-slot="scroll-area-thumb"]');
    await expect(scrollbar).toBeVisible();
    await expect(thumb).toBeVisible();

    const bottomTransform = await thumb.evaluate((element) => element.style.transform);
    await viewport.evaluate((element) => element.scrollTo({ top: 0 }));
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);
    await expect
      .poll(() => thumb.evaluate((element) => element.style.transform))
      .not.toBe(bottomTransform);

    expect(
      await host.evaluate(() => {
        const element = document.scrollingElement ?? document.documentElement;
        return element.scrollHeight <= element.clientHeight + 1;
      }),
    ).toBe(true);
  } finally {
    await cleanup();
  }
});

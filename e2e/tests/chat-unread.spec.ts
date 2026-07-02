import { expect, test } from '@playwright/test';

import { connectPeers, requireBaseURL } from './helpers';

test('chat input is disabled until a peer connects', async ({ page }) => {
  await page.goto('/room/chat-gate');
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

import { expect, test, type Page } from '@playwright/test';

const expectMessage = (page: Page, message: string) =>
  expect(page.getByRole('list', { name: 'Chat messages' }).getByText(message)).toBeVisible();

const sendMessage = async (page: Page, message: string) => {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(message);
  await input.press('Enter');
};

test('two peers connect and exchange chat messages', async ({ browser, page }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string') {
    throw new Error('The room E2E test requires a configured baseURL');
  }

  const roomId = `e2e-chat-${testInfo.workerIndex}-${Date.now()}`;
  const secondContext = await browser.newContext({ baseURL });
  const secondPage = await secondContext.newPage();

  try {
    await page.goto(`/room/${roomId}`);
    await expect(page.getByText('Share this room to invite someone.')).toBeVisible();

    await secondPage.goto(`/room/${roomId}`);
    await Promise.all([
      expect(page.getByText('Connected', { exact: true }).first()).toBeVisible(),
      expect(secondPage.getByText('Connected', { exact: true }).first()).toBeVisible(),
    ]);

    await Promise.all([
      page.getByRole('button', { name: 'Open chat' }).click(),
      secondPage.getByRole('button', { name: 'Open chat' }).click(),
    ]);

    const firstMessage = 'Hello from the first peer';
    await sendMessage(page, firstMessage);
    await Promise.all([expectMessage(page, firstMessage), expectMessage(secondPage, firstMessage)]);

    const secondMessage = 'Hello from the second peer';
    await sendMessage(secondPage, secondMessage);
    await Promise.all([
      expectMessage(page, secondMessage),
      expectMessage(secondPage, secondMessage),
    ]);
  } finally {
    await secondContext.close();
  }
});

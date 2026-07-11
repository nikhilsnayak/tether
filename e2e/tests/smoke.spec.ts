import { expect, test } from '@playwright/test';

import { createRoom } from './helpers';

test('web app loads', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A direct video line between two machines.' }),
  ).toBeVisible();
  await expect(page.getByText('01 — new call')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();
  await expect(page.getByText('02 — join')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Room code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled();
});

test('a fresh visitor must accept the disclaimer before the app renders', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://localhost:5173',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'I understand and accept' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Call' })).toBeHidden();

  await page.getByRole('button', { name: 'I understand and accept' }).click();
  await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'I understand and accept' })).toBeHidden();
  await context.close();
});

test('web app opens a signaling session', async ({ page }) => {
  const roomId = await createRoom(page);

  await expect(page.getByText('Share this room to invite someone.')).toBeVisible();
  await expect(page.getByText(`Room ${roomId}`)).toBeVisible();
});

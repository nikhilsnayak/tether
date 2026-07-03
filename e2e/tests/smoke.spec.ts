import { expect, test } from '@playwright/test';

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

test('web app opens a signaling session', async ({ page }) => {
  await page.goto('/room/e2e-smoke-room');

  await expect(page.getByText('Share this room to invite someone.')).toBeVisible();
  await expect(page.getByText('Room e2e-smoke-room')).toBeVisible();
});

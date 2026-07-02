import { expect, test } from '@playwright/test';

test('web app loads', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Start a private video call.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New call', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create room', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Join a call', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Room code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeDisabled();
});

test('web app opens a signaling session', async ({ page }) => {
  await page.goto('/room/e2e-smoke-room');

  await expect(page.getByText('Share this room to invite someone.')).toBeVisible();
  await expect(page.getByText('Room e2e-smoke-room')).toBeVisible();
});

import { expect, test } from '@playwright/test';

test('creating a room offers a copyable invite link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Your room is ready' })).toBeVisible();
  const inviteLink = await page.getByRole('textbox', { name: 'Room invite link' }).inputValue();
  expect(inviteLink).toMatch(/\/room\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);

  await page.getByRole('button', { name: 'Copy room link' }).click();
  await expect(page.getByRole('button', { name: 'Copy room link' })).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteLink);
});

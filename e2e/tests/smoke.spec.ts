import { expect, test } from './fixtures';

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

test('a fresh visitor must accept the disclaimer before the app renders', async ({ room }) => {
  const { page } = await room.createActor({
    storageState: { cookies: [], origins: [] },
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'I understand and accept' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Call' })).toBeHidden();

  await page.getByRole('button', { name: 'I understand and accept' }).click();
  await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'I understand and accept' })).toBeHidden();
});

test('web app opens a signaling session', async ({ page, room }) => {
  const roomId = await room.createRoom(room.actorFor(page));

  await expect(page.getByText('Share this room to invite someone.')).toBeVisible();
  await expect(page.getByText(`Room ${roomId}`)).toBeVisible();
});

import { expect, test } from './fixtures';

test('a dropped connection surfaces the failed screen and returns to setup', async ({ room }) => {
  const { host } = await room.connect();
  const { page } = host;
  await host.context.setOffline(true);
  await expect(page.getByText('Session failed', { exact: true }).first()).toBeVisible({
    timeout: 25_000,
  });

  await host.context.setOffline(false);
  await page.getByRole('button', { name: 'Back to room setup' }).click();
  await expect(page).toHaveURL('/');
});

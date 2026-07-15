import { expect, test } from './fixtures';

test.describe('real room', { tag: '@gpu' }, () => {
  test('creating a room offers a copyable invite link', async ({ page, context, room }) => {
    const actor = room.actorFor(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/');
    await page.getByRole('button', { name: 'Call' }).click();
    await expect(page).toHaveURL(/\/host$/);
    await room.startHostingRoom(actor);

    await expect(page.getByText('Room ready')).toBeVisible({ timeout: 20_000 });
    const inviteLink = await page.getByRole('textbox', { name: 'Room invite link' }).inputValue();
    expect(inviteLink).toMatch(/\/room\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);

    await page.getByRole('button', { name: 'Copy room link' }).click();
    await expect(page.getByRole('button', { name: 'Copy room link' })).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteLink);

    await page.getByRole('button', { name: 'Close room invite' }).click();
    await expect(page.getByRole('region', { name: 'Room invite' })).toBeHidden();
    await page.getByRole('button', { name: /Open room invite/ }).click();
    await expect(page.getByRole('textbox', { name: 'Room invite link' })).toHaveValue(inviteLink);
  });
});

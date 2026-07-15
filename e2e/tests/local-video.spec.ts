import { expect, test } from './fixtures';

test.describe('real room', { tag: '@gpu' }, () => {
  test('turning the camera off hides the local preview and shows the avatar', async ({
    page,
    room,
  }) => {
    await room.createRoom(room.actorFor(page));
    const preview = page.getByLabel('Local video preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview).not.toHaveClass(/invisible/);

    const tileAvatar = preview.locator('xpath=..').locator('[data-slot="avatar-fallback"]');
    await expect(tileAvatar).toHaveCount(0);

    await page.getByRole('button', { name: 'Turn camera off' }).click();
    await expect(preview).toHaveClass(/invisible/);
    await expect(tileAvatar).toBeVisible();

    await page.getByRole('button', { name: 'Turn camera on' }).click();
    await expect(preview).not.toHaveClass(/invisible/);
    await expect(tileAvatar).toHaveCount(0);
  });
});

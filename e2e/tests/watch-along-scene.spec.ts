import { expect, test } from './fixtures';

test('watch scene anchors are observable before a peer enables the activity', async ({
  page,
  room,
}) => {
  const actor = room.actorFor(page);
  await room.createRoom(actor);
  const scene = page.getByLabel('Dusk Suite room scene');
  await expect(scene).toHaveAttribute('data-room-watch-display', 'present');
  await expect(scene).toHaveAttribute('data-room-watch-console', 'present');
  await expect(scene).toHaveAttribute('data-room-display', 'unavailable');
  await expect(scene).toHaveAttribute('data-room-console-focus', 'free');
  await expect(page.locator('[data-room-watch-file-input]')).toHaveCount(1);
});

test(
  'watch display and console mount in the real Dusk Suite renderer',
  { tag: '@gpu' },
  async ({ page, room }) => {
    const actor = room.actorFor(page);
    await room.createRoom(actor);
    await room.expectRendererReady(actor);
    const scene = page.getByLabel('Dusk Suite room scene');
    await expect(scene.locator('canvas')).toBeVisible();
    await expect(scene).toHaveAttribute('data-room-watch-display', 'present');
    await expect(scene).toHaveAttribute('data-room-watch-console', 'present');
    await expect(scene).toHaveAttribute('data-room-console-range', 'outside');

    await page.keyboard.down('a');
    await page.waitForTimeout(300);
    await page.keyboard.up('a');
    await page.keyboard.down('w');
    await expect(scene).toHaveAttribute('data-room-console-range', 'inside', { timeout: 4_000 });
    await page.keyboard.up('w');
    await expect(scene).toHaveAttribute('data-room-local-pose', /,idle$/);

    await page.keyboard.press('Enter');
    await expect(scene).toHaveAttribute('data-room-console-focus', 'focused');
    await expect(page.locator('[data-room-media-tile]')).toHaveCount(0);
    const focusedPose = await scene.getAttribute('data-room-local-pose');
    await page.keyboard.down('w');
    await page.waitForTimeout(350);
    await page.keyboard.up('w');
    expect(await scene.getAttribute('data-room-local-pose')).toBe(focusedPose);

    await page.getByRole('button', { name: 'Reveal camera tiles' }).click();
    await expect(page.locator('[data-room-media-tile="self"]')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(scene).toHaveAttribute('data-room-console-focus', 'free');
  },
);

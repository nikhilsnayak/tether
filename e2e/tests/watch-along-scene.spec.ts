import { expect, test } from './fixtures';

test('watch panel and 3D display are part of the Dusk Suite room', async ({ page, room }) => {
  const actor = room.actorFor(page);
  await room.createRoom(actor);

  await expect(page.getByLabel('Watch together')).toBeVisible();
  await expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
    'data-room-watch-display',
    'present',
  );
  await expect(page.locator('[data-watch-file-input]')).toHaveCount(1);
});

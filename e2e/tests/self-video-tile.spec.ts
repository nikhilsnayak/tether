import { expect, test, type Page } from '@playwright/test';

import { createRoom } from './helpers';

const tileInset = (page: Page) =>
  page.getByLabel('Local video preview').evaluate((video: HTMLVideoElement) => {
    const tile = video.parentElement as HTMLElement;
    const stage = tile.offsetParent as HTMLElement;
    const t = tile.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      left: Math.round(t.left - s.left),
      top: Math.round(t.top - s.top),
      right: Math.round(s.right - t.right),
      bottom: Math.round(s.bottom - t.bottom),
    };
  });

const stageBox = (page: Page) =>
  page.getByLabel('Local video preview').evaluate((video: HTMLVideoElement) => {
    const stage = (video.parentElement as HTMLElement).offsetParent as HTMLElement;
    const s = stage.getBoundingClientRect();
    return { x: s.x, y: s.y, width: s.width, height: s.height };
  });

const dragTileTo = async (page: Page, x: number, y: number) => {
  const box = await page.getByLabel('Local video preview').boundingBox();
  if (box === null) {
    throw new Error('Expected the self-video tile to be visible');
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(startX + ((x - startX) * step) / 6, startY + ((y - startY) * step) / 6);
  }
  await page.mouse.up();
};

const NEAR = 24;

test('self-video tile snaps to whichever corner it is dragged to', async ({ page }) => {
  await createRoom(page);
  await expect(page.getByLabel('Local video preview')).toBeVisible();

  await expect.poll(async () => (await tileInset(page)).right).toBeLessThanOrEqual(NEAR);
  await expect.poll(async () => (await tileInset(page)).bottom).toBeLessThanOrEqual(NEAR);

  const stage = await stageBox(page);

  await dragTileTo(page, stage.x + 70, stage.y + 110);
  await expect.poll(async () => (await tileInset(page)).left).toBeLessThanOrEqual(NEAR);
  await expect.poll(async () => (await tileInset(page)).top).toBeLessThanOrEqual(NEAR);

  await dragTileTo(page, stage.x + stage.width - 70, stage.y + 110);
  await expect.poll(async () => (await tileInset(page)).right).toBeLessThanOrEqual(NEAR);
  await expect.poll(async () => (await tileInset(page)).top).toBeLessThanOrEqual(NEAR);

  await dragTileTo(page, stage.x + 70, stage.y + stage.height - 110);
  await expect.poll(async () => (await tileInset(page)).left).toBeLessThanOrEqual(NEAR);
  await expect.poll(async () => (await tileInset(page)).bottom).toBeLessThanOrEqual(NEAR);
});

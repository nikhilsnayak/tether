import { expect, test, type Page } from '@playwright/test';

import { connectPeers, createRoom, requireBaseURL } from './helpers';

const fitsViewport = (page: Page) =>
  page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
  });

test('home page fits the viewport', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A direct video line between two machines.' }),
  ).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test('room waiting screen fits the viewport', async ({ page }) => {
  await createRoom(page);
  await expect(page.getByText('Share this room to invite someone.')).toBeVisible();
  const scene = page.getByLabel('Dusk Suite interactive preview');
  await expect(scene.locator('canvas')).toBeVisible();
  await page.getByLabel('Room rendering quality').selectOption('medium');
  await expect(scene).toHaveAttribute('data-room-quality-tier', 'medium');
  expect(await page.evaluate(() => localStorage.getItem('tether.room.quality'))).toBe('medium');
  const controls = page.getByRole('toolbar', { name: 'Call controls' });
  await expect(controls.getByRole('button')).toHaveCount(5);
  await expect(controls.getByRole('button', { name: 'Leave call' })).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test('reduced motion keeps the full 3D room without camera travel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createRoom(page);
  const scene = page.getByLabel('Dusk Suite interactive preview');
  await expect(scene).toHaveAttribute('data-room-reduced-motion', 'true');
  await expect(scene.locator('canvas')).toBeVisible();
});

test('the WebGPU call room fits a portrait viewport without covering controls', async ({
  browser,
}, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { host, cleanup } = await connectPeers(browser, baseURL);
  try {
    await host.setViewportSize({ width: 390, height: 844 });
    const scene = host.getByLabel('Dusk Suite interactive preview');
    await expect(scene).toHaveAttribute('data-room-remote-video', 'present');
    await expect(scene.locator('canvas')).toBeVisible();
    await expect(host.getByRole('button', { name: 'Leave call' })).toBeVisible();
    await expect(host.getByLabel('Local video preview')).toBeVisible();
    expect(await fitsViewport(host)).toBe(true);

    const controls = await host.getByRole('button', { name: 'Leave call' }).boundingBox();
    const preview = await host.getByLabel('Local video preview').boundingBox();
    expect(controls).not.toBeNull();
    expect(preview).not.toBeNull();
    if (controls !== null && preview !== null) {
      expect(preview.y + preview.height).toBeLessThanOrEqual(controls.y);
    }
  } finally {
    await cleanup();
  }
});

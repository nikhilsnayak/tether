import { expect, test, type Page } from '@playwright/test';

import { connectPeers, requireBaseURL } from './helpers';

const fitsViewport = (page: Page) =>
  page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
  });

test('home page fits the viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Start a private video call.' })).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test('room waiting screen fits the viewport', async ({ page }) => {
  await page.goto('/room/layout-waiting');
  await expect(page.getByText('Share this room to invite someone.')).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test('a portrait remote video does not overflow the room', async ({ browser }, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { host, cleanup } = await connectPeers(browser, baseURL);
  try {
    const remote = host.getByLabel('Remote video');
    await expect(remote).toBeVisible();

    await remote.evaluate((video: HTMLVideoElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 800;
      canvas.getContext('2d')?.fillRect(0, 0, 300, 800);
      video.srcObject = canvas.captureStream(5);
      return video.play().catch(() => {});
    });

    await expect.poll(() => remote.evaluate((v: HTMLVideoElement) => v.videoHeight)).toBe(800);
    await expect
      .poll(() =>
        host.evaluate(() => {
          const el = document.scrollingElement ?? document.documentElement;
          return el.scrollHeight <= el.clientHeight + 1;
        }),
      )
      .toBe(true);
  } finally {
    await cleanup();
  }
});

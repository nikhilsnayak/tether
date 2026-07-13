import { expect, test } from '@playwright/test';

import { createRoom } from './helpers';

test('missing WebGPU stops entry before media is requested', async ({ page }) => {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    let mediaRequests = 0;
    mediaDevices.getUserMedia = (...args) => {
      mediaRequests += 1;
      return getUserMedia(...args);
    };
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, '__tetherMediaRequests', {
      configurable: true,
      get: () => mediaRequests,
    });
  });

  await page.goto('/host');
  await expect(page.getByText('This browser cannot enter the room')).toBeVisible();
  await expect(page.getByText(/Missing: webgpu/)).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__tetherMediaRequests'))).toBe(0);
});

test('Dusk Suite loads without third-party room assets', async ({ page }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('Expected a configured baseURL');
  const appOrigin = new URL(baseURL).origin;
  const externalAssets: string[] = [];
  page.on('request', (request) => {
    if (!['font', 'image', 'media'].includes(request.resourceType())) return;
    const url = new URL(request.url());
    if (url.origin !== appOrigin) externalAssets.push(url.href);
  });

  await createRoom(page);
  await expect(page.getByLabel('Dusk Suite interactive preview').locator('canvas')).toBeVisible();
  expect(externalAssets).toEqual([]);
});

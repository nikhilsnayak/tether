import { expect, test } from '@playwright/test';

import { createRoom, installWebRtcProbe } from './helpers';

test('missing WebGL2 stops entry before media is requested', async ({ page }) => {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    let mediaRequests = 0;
    mediaDevices.getUserMedia = (...args) => {
      mediaRequests += 1;
      return getUserMedia(...args);
    };
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'canvas') {
        const canvas = element as HTMLCanvasElement;
        canvas.getContext = () => null;
      }
      return element;
    }) as typeof document.createElement;
    Object.defineProperty(window, '__tetherMediaRequests', {
      configurable: true,
      get: () => mediaRequests,
    });
  });

  await page.goto('/host');
  await expect(page.getByText('This browser cannot enter the room')).toBeVisible();
  await expect(page.getByText(/Missing: webgl2/)).toBeVisible();
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

test('backing out of media setup stops the preview stream', async ({ page }) => {
  await installWebRtcProbe(page.context());
  await page.goto('/');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.getByRole('heading', { name: 'Look and sound ready?' })).toBeVisible();
  expect(await page.evaluate(() => window.__tetherE2E.localStreams.length)).toBe(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Camera preview')).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        acquiredStreams: window.__tetherE2E.localStreams.length,
        previewStopped:
          window.__tetherE2E.localStreams[0]
            ?.getTracks()
            .every((track) => track.readyState === 'ended') ?? false,
      })),
    )
    .toEqual({ acquiredStreams: 1, previewStopped: true });
});

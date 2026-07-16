import { expect, test } from './fixtures';
import { highQualityStorageState } from './storage-seed';

test('missing WebGL2 stops entry before media is requested', { tag: '@gpu' }, async ({ page }) => {
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
  await expect(page.getByText(/Missing: WebGL2/)).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__tetherMediaRequests'))).toBe(0);
});

test.describe('high-quality renderer', () => {
  test.use({ storageState: highQualityStorageState });

  test(
    'Dusk Suite loads without third-party room assets',
    { tag: '@gpu' },
    async ({ page, room }) => {
      const appOrigin = new URL(room.baseURL).origin;
      const externalAssets: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin !== appOrigin) externalAssets.push(url.href);
      });

      const actor = room.actorFor(page);
      await room.createRoom(actor);
      const scene = page.getByLabel('Dusk Suite room scene');
      await expect(scene).toHaveAttribute('data-room-quality-tier', 'high');
      await room.expectRendererReady(actor);
      await expect(scene.locator('canvas')).toBeVisible();
      // The room keeps a live signaling connection open, so true network-idle
      // never fires; a short settle window is enough to catch lazy-loaded assets.
      await page.waitForTimeout(1_000);
      expect(externalAssets).toEqual([]);
    },
  );
});

test('a guest waits at the exterior before knocking', { tag: '@gpu' }, async ({ page, room }) => {
  const host = room.actorFor(page);
  const guest = await room.createActor();
  const roomId = await room.createRoom(host);
  await room.prepareGuestAtThreshold(guest, roomId);

  const scene = guest.page.getByLabel('Dusk Suite room scene');
  await expect(scene.locator('canvas')).toBeVisible();
  await expect(scene).toHaveAttribute('data-room-journey', 'outside');
  await expect(scene).toHaveAttribute('data-room-location', 'outside');
  await expect(guest.page.getByRole('button', { name: 'Knock on door' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Join request' })).toBeHidden();
});

test(
  'backing out of media setup stops the preview stream',
  { tag: '@gpu' },
  async ({ page, room }) => {
    const actor = await room.actorFor(page, { probeWebRtc: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Call' }).click();
    await expect(page.getByRole('heading', { name: 'Look and sound ready?' })).toBeVisible();
    expect(await actor.probe.localStreamCount()).toBe(0);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByLabel('Camera preview')).toBeVisible();

    await page.getByRole('button', { name: 'Back' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();
    await expect
      .poll(() => actor.probe.previewCleanupState())
      .toEqual({ acquiredStreams: 1, previewStopped: true });
  },
);

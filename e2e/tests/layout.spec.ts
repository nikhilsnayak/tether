import { expect, test, type Page } from './fixtures';
import { automaticQualityStorageState } from './storage-seed';

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

test.describe('automatic room quality', () => {
  test.use({ storageState: automaticQualityStorageState });

  test('room waiting screen fits the viewport', { tag: '@gpu' }, async ({ page, room }) => {
    const actor = room.actorFor(page);
    await room.createRoom(actor);
    await expect(page.getByText('Share this room to invite someone.')).toBeVisible();
    const scene = page.getByLabel('Dusk Suite room scene');
    await expect(scene.locator('canvas')).toBeVisible();
    const quality = page.getByRole('button', { name: 'Room quality' });
    await quality.click();
    await page.getByRole('menuitemradio', { name: 'Low quality' }).click();
    await expect(quality).toHaveAttribute('data-quality-preference', 'low');
    await expect(scene).toHaveAttribute('data-room-quality-tier', 'low');
    expect(await page.evaluate(() => localStorage.getItem('tether.room.quality'))).toBe('low');
    const controls = page.getByRole('toolbar', { name: 'Call controls' });
    await expect(controls.getByRole('button')).toHaveCount(6);
    await expect(controls.getByRole('button', { name: 'Leave call' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Avatar controls' })).toBeHidden();
    const controlHelp = page.getByRole('button', { name: 'Room controls help' });
    await expect(controlHelp).toBeVisible();
    await controlHelp.hover();
    await expect(page.getByRole('heading', { name: 'Room controls' })).toBeVisible();
    const headerBox = await page.locator('[data-room-call-header]').boundingBox();
    const qualityBox = await page.locator('[data-room-quality-control]').boundingBox();
    expect(headerBox).not.toBeNull();
    expect(qualityBox).not.toBeNull();
    if (headerBox !== null && qualityBox !== null) {
      expect(qualityBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
    }
    expect(await fitsViewport(page)).toBe(true);

    await page.reload();
    await room.completeMediaSetup(actor, 'Invite someone');
    await expect(page.getByRole('button', { name: 'Room quality' })).toHaveAttribute(
      'data-quality-preference',
      'low',
    );
    await expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-quality-tier',
      'low',
    );
  });
});

test(
  'reduced motion keeps the full 3D room without camera travel',
  { tag: ['@gpu', '@real-render-smoke'] },
  async ({ page, room }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await room.createRoom(room.actorFor(page));
    const scene = page.getByLabel('Dusk Suite room scene');
    await expect(scene).toHaveAttribute('data-room-reduced-motion', 'true');
    await expect(scene.locator('canvas')).toBeVisible();
  },
);

test(
  'the WebGPU call room fits phone viewports without covering controls',
  { tag: '@gpu' },
  async ({ room }) => {
    const { host } = await room.connect();
    const { page } = host;
    await page.setViewportSize({ width: 390, height: 844 });
    const scene = page.getByLabel('Dusk Suite room scene');
    await expect(scene).toHaveAttribute('data-room-remote-avatar', 'present');
    await expect(scene.locator('canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leave call' })).toBeVisible();
    await expect(page.getByLabel('Local video preview')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Room quality' })).toBeVisible();
    expect(await fitsViewport(page)).toBe(true);

    const controls = await page.getByRole('button', { name: 'Leave call' }).boundingBox();
    const preview = await page.getByLabel('Local video preview').boundingBox();
    expect(controls).not.toBeNull();
    expect(preview).not.toBeNull();
    if (controls !== null && preview !== null) {
      expect(preview.y + preview.height).toBeLessThanOrEqual(controls.y);
    }

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole('button', { name: 'Leave call' })).toBeVisible();
    await expect(page.getByLabel('Local video preview')).toBeVisible();
    expect(await fitsViewport(page)).toBe(true);

    const landscapeControls = await page.getByRole('button', { name: 'Leave call' }).boundingBox();
    const landscapePreview = await page.getByLabel('Local video preview').boundingBox();
    expect(landscapeControls).not.toBeNull();
    expect(landscapePreview).not.toBeNull();
    if (landscapeControls !== null && landscapePreview !== null) {
      expect(landscapePreview.y + landscapePreview.height).toBeLessThanOrEqual(landscapeControls.y);
    }
  },
);

import { expect, test, type Page } from '@playwright/test';

import {
  admitGuest,
  createRoom,
  denyGuest,
  expectConnected,
  expectPeerDeparted,
  expectPreparedMediaTransferred,
  expectWaitingForPeer,
  installWebRtcProbe,
  joinRoom,
  prepareGuestAtThreshold,
  requireBaseURL,
  startHostingRoom,
} from './helpers';
import { seededStorageState } from './storage-seed';

const expectMessage = (page: Page, message: string) =>
  expect(page.getByRole('list', { name: 'Chat messages' }).getByText(message)).toBeVisible();

const sendMessage = async (page: Page, message: string) => {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(message);
  await input.press('Enter');
};

const trackKinds = (page: Page, selector: string) =>
  page.locator(selector).evaluate((video: HTMLVideoElement) => {
    const stream = video.srcObject;
    return stream instanceof MediaStream
      ? stream
          .getTracks()
          .map((track) => track.kind)
          .sort()
      : [];
  });

const localTrackEnabled = (page: Page, kind: 'audio' | 'video') =>
  page.getByLabel('Local video preview').evaluate((video: HTMLVideoElement, trackKind) => {
    const stream = video.srcObject;
    return stream instanceof MediaStream
      ? (stream.getTracks().find((track) => track.kind === trackKind)?.enabled ?? null)
      : null;
  }, kind);

const mediaTilesAvoidToolbar = (page: Page) =>
  page.evaluate(() => {
    const toolbar = document.querySelector('[data-call-dock]')?.getBoundingClientRect();
    const tiles = [...document.querySelectorAll('[data-room-media-tile]')].map((element) =>
      element.getBoundingClientRect(),
    );
    if (toolbar === undefined || tiles.length !== 2) return false;
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return !tiles.some((tile) => overlaps(tile, toolbar)) && !overlaps(tiles[0]!, tiles[1]!);
  });

const lowQualityMedianFps = async (page: Page) => {
  await page.getByLabel('Room rendering quality').selectOption('low');
  await page.waitForTimeout(2_000);
  const samples: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    await page.waitForTimeout(1_000);
    const value = Number(
      await page.getByLabel('Dusk Suite room scene').getAttribute('data-room-fps'),
    );
    if (Number.isFinite(value)) samples.push(value);
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)] ?? 0;
};

const expectLocalAndRemoteMedia = async (page: Page) => {
  await expect(page.getByLabel('Local video preview')).toBeVisible();
  await expect(page.getByLabel('Other person video')).toBeVisible();
  await expect
    .poll(() =>
      page.getByLabel('Other person video').evaluate((video: HTMLVideoElement) => video.muted),
    )
    .toBe(true);
  await expect(page.getByLabel('Remote audio')).toBeAttached();
  await expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
    'data-room-display',
    'idle',
  );
  await expect
    .poll(() => trackKinds(page, 'video[aria-label="Local video preview"]'))
    .toEqual(['audio', 'video']);
  await expect
    .poll(() => trackKinds(page, 'audio[aria-label="Remote audio"]'))
    .toEqual(['audio', 'video']);
  await expect
    .poll(() => trackKinds(page, 'video[aria-label="Other person video"]'))
    .toEqual(['audio', 'video']);
};

test('complete room flow', async ({ browser, page }, testInfo) => {
  test.slow();
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);

  await installWebRtcProbe(page.context());
  const guestContext = await browser.newContext({ baseURL, storageState: seededStorageState });
  const replacementContext = await browser.newContext({
    baseURL,
    storageState: seededStorageState,
  });
  await Promise.all([installWebRtcProbe(guestContext), installWebRtcProbe(replacementContext)]);
  const guestPage = await guestContext.newPage();
  const replacementPage = await replacementContext.newPage();

  let roomId = '';
  try {
    await test.step('host creates a meeting', async () => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Call' }).click();
      await expect(page).toHaveURL(/\/host$/);
      await startHostingRoom(page);
      await expect(page.getByText('Room ready')).toBeVisible({ timeout: 20_000 });
      const inviteLink = page.getByRole('textbox', { name: 'Room invite link' });
      await expect(inviteLink).toHaveValue(/\/room\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
      await expect(page.getByRole('button', { name: 'Copy room link' })).toBeVisible();
      await expectPreparedMediaTransferred(page);
      const url = await inviteLink.inputValue();
      const capturedId = url.split('/').at(-1);
      if (capturedId === undefined || capturedId === '') {
        throw new Error('Expected the invite link to contain a room id');
      }
      roomId = decodeURIComponent(capturedId);
      await page.getByRole('button', { name: 'Close' }).click();
      await expectWaitingForPeer(page);
    });

    await test.step('guest joins by room code and media connects', async () => {
      await prepareGuestAtThreshold(guestPage, roomId);
      const guestScene = guestPage.getByLabel('Dusk Suite room scene');
      await expect(guestScene.locator('canvas')).toBeVisible();
      await expect(guestScene).toHaveAttribute('data-room-journey', 'outside');
      await expect(guestScene).toHaveAttribute('data-room-location', 'outside');
      await expect(guestScene).toHaveAttribute('data-room-admission', 'idle');
      await expect(guestScene).toHaveAttribute('data-room-local-avatar', 'present');
      await expect(guestScene).toHaveAttribute('data-room-remote-avatar', 'absent');
      await expect(page.getByRole('region', { name: 'Join request' })).toBeHidden();

      await guestPage.getByRole('button', { name: 'Knock on door', exact: true }).click();
      await expect(guestPage.getByLabel('Dusk Suite room scene')).toHaveAttribute(
        'data-room-journey',
        /outside|connecting/,
      );
      await expect(guestPage.getByRole('region', { name: 'Waiting outside' })).toBeVisible();
      await expect(guestPage.getByRole('button', { name: 'Leave room' })).toBeVisible();
      await expect(guestPage.getByRole('toolbar', { name: 'Call controls' })).toBeHidden();
      await expect(guestPage.getByLabel('Room rendering quality')).toBeHidden();
      await expectPreparedMediaTransferred(guestPage);
      await expect(page.getByRole('region', { name: 'Join request' })).toBeVisible();
      await expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
        'data-room-admission',
        'pending',
      );
      await admitGuest(page);
      await Promise.all([expectConnected(page), expectConnected(guestPage)]);
      await Promise.all([
        expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
          'data-room-journey',
          'together',
        ),
        expect(guestPage.getByLabel('Dusk Suite room scene')).toHaveAttribute(
          'data-room-location',
          'inside',
        ),
      ]);
      await Promise.all([expectLocalAndRemoteMedia(page), expectLocalAndRemoteMedia(guestPage)]);
      await Promise.all([
        expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
          'data-room-local-avatar',
          'present',
        ),
        expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
          'data-room-remote-avatar',
          'present',
        ),
        expect(guestPage.getByLabel('Dusk Suite room scene')).toHaveAttribute(
          'data-room-local-avatar',
          'present',
        ),
        expect(guestPage.getByLabel('Dusk Suite room scene')).toHaveAttribute(
          'data-room-remote-avatar',
          'present',
        ),
      ]);
      await Promise.all([
        expect(page.locator('[data-room-avatar-sync]')).toHaveAttribute(
          'data-room-avatar-sync',
          'ready',
        ),
        expect(guestPage.locator('[data-room-avatar-sync]')).toHaveAttribute(
          'data-room-avatar-sync',
          'ready',
        ),
      ]);
      await expect
        .poll(() => guestPage.evaluate(() => window.__tetherE2E.dataChannels.at(-1)?.label ?? null))
        .toBe('room-events-v1');
      await Promise.all([
        page.getByRole('button', { name: 'We see the same code' }).click(),
        guestPage.getByRole('button', { name: 'We see the same code' }).click(),
      ]);
      await expect(page.getByRole('toolbar', { name: 'Call controls' })).toBeVisible();
    });

    // GitHub's single SwiftShader GPU process does not reliably advance two R3F
    // frame loops. Presence and room-event sync remain covered above; run the
    // physical movement interaction when Chromium has a hardware renderer.
    if (!process.env.CI) {
      await test.step('each peer controls only its own physical avatar', async () => {
        const hostScene = page.getByLabel('Dusk Suite room scene');
        const guestScene = guestPage.getByLabel('Dusk Suite room scene');
        await expect(hostScene).toHaveAttribute('data-room-local-pose', /.+/);
        await expect(guestScene).toHaveAttribute('data-room-local-pose', /.+/);
        const guestLocalBefore = await guestScene.getAttribute('data-room-local-pose');
        const hostLocalBefore = await hostScene.getAttribute('data-room-local-pose');

        await page.keyboard.down('w');
        await page.waitForTimeout(350);
        await page.keyboard.up('w');
        await expect
          .poll(() => hostScene.getAttribute('data-room-local-pose'))
          .not.toBe(hostLocalBefore);
        await expect.poll(() => guestScene.getAttribute('data-room-remote-pose')).not.toBeNull();
        expect(await guestScene.getAttribute('data-room-local-pose')).toBe(guestLocalBefore);

        const turnLeft = page.getByRole('button', { name: 'Turn avatar left' });
        await turnLeft.click();
        await expect(turnLeft).toBeFocused();
        const hostAfterControlTap = await hostScene.getAttribute('data-room-local-pose');
        await page.keyboard.down('w');
        await page.waitForTimeout(350);
        await page.keyboard.up('w');
        await expect
          .poll(() => hostScene.getAttribute('data-room-local-pose'))
          .not.toBe(hostAfterControlTap);
        await expect(hostScene).toHaveAttribute('data-room-local-pose', /,idle$/);

        const hostLocalAfter = await hostScene.getAttribute('data-room-local-pose');
        const guestLocalStill = await guestScene.getAttribute('data-room-local-pose');
        await guestPage.keyboard.down('ArrowUp');
        await guestPage.waitForTimeout(350);
        await guestPage.keyboard.up('ArrowUp');
        await expect
          .poll(() => guestScene.getAttribute('data-room-local-pose'))
          .not.toBe(guestLocalStill);
        expect(await hostScene.getAttribute('data-room-local-pose')).toBe(hostLocalAfter);
      });
    }

    if (!process.env.CI) {
      await test.step('responsive media tiles avoid controls and low quality sustains 30 FPS', async () => {
        for (const viewport of [
          { width: 1_280, height: 720 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          await expect.poll(() => mediaTilesAvoidToolbar(page)).toBe(true);
          expect(await lowQualityMedianFps(page)).toBeGreaterThanOrEqual(30);
        }
        await page.setViewportSize({ width: 1_280, height: 720 });
      });
    }

    await test.step('local media controls synchronize explicit remote state', async () => {
      await expect(page.locator('[data-room-remote-camera]')).toHaveAttribute(
        'data-room-remote-camera',
        'on',
      );
      await expect(page.locator('[data-room-remote-microphone]')).toHaveAttribute(
        'data-room-remote-microphone',
        'on',
      );
      await expect.poll(() => localTrackEnabled(page, 'video')).toBe(true);
      await page.getByRole('button', { name: 'Turn camera off' }).click();
      await expect(page.getByRole('button', { name: 'Turn camera on' })).toBeVisible();
      await expect.poll(() => localTrackEnabled(page, 'video')).toBe(false);
      await expect(guestPage.locator('[data-room-remote-camera]')).toHaveAttribute(
        'data-room-remote-camera',
        'off',
      );
      await expect(guestPage.getByLabel('Dusk Suite room scene')).toHaveAttribute(
        'data-room-remote-avatar',
        'present',
      );
      await expect(guestPage.locator('[data-room-media-tile="remote"]')).toBeVisible();
      await expect(guestPage.getByLabel('Other person camera unavailable')).toBeVisible();
      await expect(guestPage.locator('[data-room-remote-microphone]')).toHaveAttribute(
        'data-room-remote-microphone',
        'on',
      );
      await page.getByRole('button', { name: 'Turn camera on' }).click();
      await expect.poll(() => localTrackEnabled(page, 'video')).toBe(true);
      await expect(guestPage.locator('[data-room-remote-camera]')).toHaveAttribute(
        'data-room-remote-camera',
        'on',
      );

      await expect.poll(() => localTrackEnabled(page, 'audio')).toBe(true);
      await page.getByRole('button', { name: 'Mute microphone' }).click();
      await expect(page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible();
      await expect.poll(() => localTrackEnabled(page, 'audio')).toBe(false);
      await expect(guestPage.locator('[data-room-remote-microphone]')).toHaveAttribute(
        'data-room-remote-microphone',
        'off',
      );
      await page.getByRole('button', { name: 'Unmute microphone' }).click();
      await expect.poll(() => localTrackEnabled(page, 'audio')).toBe(true);
      await expect(guestPage.locator('[data-room-remote-microphone]')).toHaveAttribute(
        'data-room-remote-microphone',
        'on',
      );
    });

    await test.step('peers exchange chat messages', async () => {
      await Promise.all([
        page.getByRole('button', { name: 'Open chat' }).click(),
        guestPage.getByRole('button', { name: 'Open chat' }).click(),
      ]);

      const hostMessage = 'Hello from the host';
      const poseBeforeTyping = await page
        .getByLabel('Dusk Suite room scene')
        .getAttribute('data-room-local-pose');
      await sendMessage(page, hostMessage);
      expect(
        await page.getByLabel('Dusk Suite room scene').getAttribute('data-room-local-pose'),
      ).toBe(poseBeforeTyping);
      await Promise.all([expectMessage(page, hostMessage), expectMessage(guestPage, hostMessage)]);

      const guestMessage = 'Hello from the guest';
      await sendMessage(guestPage, guestMessage);
      await Promise.all([
        expectMessage(page, guestMessage),
        expectMessage(guestPage, guestMessage),
      ]);

      await Promise.all([
        page.getByRole('button', { name: 'Close' }).click(),
        guestPage.getByRole('button', { name: 'Close' }).click(),
      ]);
    });

    await test.step('a third peer is rejected while the room is full', async () => {
      await joinRoom(replacementPage, roomId);
      await expect(
        replacementPage.getByText('Room is full', { exact: true }).first(),
      ).toBeVisible();
      await expect
        .poll(() =>
          replacementPage.evaluate(
            () =>
              window.__tetherE2E.localStreams.length > 0 &&
              window.__tetherE2E.localStreams.every((stream) =>
                stream.getTracks().every((track) => track.readyState === 'ended'),
              ),
          ),
        )
        .toBe(true);
      await replacementPage.getByRole('button', { name: 'Back to room setup' }).click();
      await expect(replacementPage).toHaveURL('/');
    });

    await test.step('the guest leaves and a replacement peer joins', async () => {
      await guestPage.getByRole('button', { name: 'Leave call' }).click();
      await expect(guestPage).toHaveURL('/');
      await expectPeerDeparted(page);

      await joinRoom(replacementPage, roomId);
      await admitGuest(page);
      await Promise.all([expectConnected(page), expectConnected(replacementPage)]);
      await Promise.all([
        expectLocalAndRemoteMedia(page),
        expectLocalAndRemoteMedia(replacementPage),
      ]);
      await Promise.all([
        page.getByRole('button', { name: 'We see the same code' }).click(),
        replacementPage.getByRole('button', { name: 'We see the same code' }).click(),
      ]);
    });

    await test.step('both remaining peers leave the room', async () => {
      await page.getByRole('button', { name: 'Leave call' }).click();
      await expect(page).toHaveURL('/');
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.__tetherE2E.localStreams.every((stream) =>
              stream.getTracks().every((track) => track.readyState === 'ended'),
            ),
          ),
        )
        .toBe(true);
      await expect(replacementPage.getByLabel('Dusk Suite room scene')).toHaveAttribute(
        'data-room-journey',
        'departed',
      );
      await replacementPage.getByRole('button', { name: 'Return home' }).click();
      await expect(replacementPage).toHaveURL('/');
    });
  } finally {
    await Promise.all([guestContext.close(), replacementContext.close()]);
  }
});

test('denying a knock keeps the host inside and the guest outside', async ({
  browser,
  page,
}, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  await installWebRtcProbe(page.context());
  const guestContext = await browser.newContext({ baseURL, storageState: seededStorageState });
  await installWebRtcProbe(guestContext);
  const guest = await guestContext.newPage();

  try {
    const roomId = await createRoom(page);
    await joinRoom(guest, roomId, 'Uninvited guest');
    await expect(page.getByRole('region', { name: 'Join request' })).toBeVisible();
    await denyGuest(page);

    await expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-journey',
      'waiting',
    );
    await expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-location',
      'inside',
    );
    await expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-remote-avatar',
      'absent',
    );
    await expect(guest.getByText('Request declined', { exact: true }).first()).toBeVisible();
    await expect(guest.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-journey',
      'ended',
    );
    await expect(guest.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-remote-avatar',
      'absent',
    );
  } finally {
    await guestContext.close();
  }
});

import { expect, test, type Page } from '@playwright/test';

import {
  admitGuest,
  expectConnected,
  expectWaitingForPeer,
  installWebRtcProbe,
  joinRoom,
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

const expectLocalAndRemoteMedia = async (page: Page) => {
  await expect(page.getByLabel('Local video preview')).toBeVisible();
  await expect(page.getByLabel('Remote audio')).toBeAttached();
  await expect(page.getByLabel('Dusk Suite interactive preview')).toHaveAttribute(
    'data-room-remote-video',
    'present',
  );
  await expect
    .poll(() => trackKinds(page, 'video[aria-label="Local video preview"]'))
    .toEqual(['audio', 'video']);
  await expect
    .poll(() => trackKinds(page, 'audio[aria-label="Remote audio"]'))
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
      await joinRoom(guestPage, roomId);
      await expect(guestPage.getByLabel('Dusk Suite interactive preview')).toHaveAttribute(
        'data-room-journey',
        /outside|screen-connecting/,
      );
      await expect(guestPage.getByRole('region', { name: 'Waiting for the host' })).toBeVisible();
      await expect(guestPage.getByRole('button', { name: 'Leave room' })).toBeVisible();
      await expect(guestPage.getByRole('toolbar', { name: 'Call controls' })).toBeHidden();
      await expect(guestPage.getByLabel('Room rendering quality')).toBeHidden();
      await expect(page.getByRole('region', { name: 'Join request' })).toBeVisible();
      await expect(page.getByLabel('Dusk Suite interactive preview')).toHaveAttribute(
        'data-room-admission',
        'pending',
      );
      await admitGuest(page);
      await Promise.all([expectConnected(page), expectConnected(guestPage)]);
      await Promise.all([expectLocalAndRemoteMedia(page), expectLocalAndRemoteMedia(guestPage)]);
      await Promise.all([
        page.getByRole('button', { name: 'We see the same code' }).click(),
        guestPage.getByRole('button', { name: 'We see the same code' }).click(),
      ]);
      await expect(page.getByRole('toolbar', { name: 'Call controls' })).toBeVisible();
    });

    await test.step('local media controls toggle their tracks', async () => {
      await expect.poll(() => localTrackEnabled(page, 'audio')).toBe(true);
      await page.getByRole('button', { name: 'Mute microphone' }).click();
      await expect(page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible();
      await expect.poll(() => localTrackEnabled(page, 'audio')).toBe(false);
      await page.getByRole('button', { name: 'Unmute microphone' }).click();
      await expect.poll(() => localTrackEnabled(page, 'audio')).toBe(true);

      await expect.poll(() => localTrackEnabled(page, 'video')).toBe(true);
      await page.getByRole('button', { name: 'Turn camera off' }).click();
      await expect(page.getByRole('button', { name: 'Turn camera on' })).toBeVisible();
      await expect.poll(() => localTrackEnabled(page, 'video')).toBe(false);
      await page.getByRole('button', { name: 'Turn camera on' }).click();
      await expect.poll(() => localTrackEnabled(page, 'video')).toBe(true);
    });

    await test.step('peers exchange chat messages', async () => {
      await Promise.all([
        page.getByRole('button', { name: 'Open chat' }).click(),
        guestPage.getByRole('button', { name: 'Open chat' }).click(),
      ]);

      const hostMessage = 'Hello from the host';
      await sendMessage(page, hostMessage);
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
      await expectWaitingForPeer(page);

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
      await expect(replacementPage.getByLabel('Dusk Suite interactive preview')).toHaveAttribute(
        'data-room-journey',
        'screen-departed',
      );
      await replacementPage.getByRole('button', { name: 'Return home' }).click();
      await expect(replacementPage).toHaveURL('/');
    });
  } finally {
    await Promise.all([guestContext.close(), replacementContext.close()]);
  }
});

import { expect, test, type Page } from '@playwright/test';

const expectConnected = (page: Page) =>
  expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();

const expectWaitingForPeer = (page: Page) =>
  expect(page.getByText('Share this room to invite someone.')).toBeVisible();

const expectMessage = (page: Page, message: string) =>
  expect(page.getByRole('list', { name: 'Chat messages' }).getByText(message)).toBeVisible();

const sendMessage = async (page: Page, message: string) => {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(message);
  await input.press('Enter');
};

const joinRoom = async (page: Page, roomId: string) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Room code' }).fill(roomId);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${roomId}$`));
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
  await expect(page.getByLabel('Remote video')).toBeVisible();
  await expect
    .poll(() => trackKinds(page, 'video[aria-label="Local video preview"]'))
    .toEqual(['audio', 'video']);
  await expect
    .poll(() => trackKinds(page, 'video[aria-label="Remote video"]'))
    .toEqual(['audio', 'video']);
};

test('complete room flow', async ({ browser, page }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string') {
    throw new Error('The room E2E test requires a configured baseURL');
  }

  const guestContext = await browser.newContext({ baseURL });
  const replacementContext = await browser.newContext({ baseURL });
  const guestPage = await guestContext.newPage();
  const replacementPage = await replacementContext.newPage();

  try {
    await test.step('host creates a meeting', async () => {
      await page.goto('/');
      await page.getByRole('button', { name: 'New meeting' }).click();
      await expect(page).toHaveURL(/\/room\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
      await expectWaitingForPeer(page);
    });

    const roomId = page.url().split('/').at(-1);
    if (roomId === undefined) {
      throw new Error('Expected the generated meeting URL to contain a room id');
    }

    await test.step('guest joins by room code and media connects', async () => {
      await joinRoom(guestPage, roomId);
      await Promise.all([expectConnected(page), expectConnected(guestPage)]);
      await Promise.all([expectLocalAndRemoteMedia(page), expectLocalAndRemoteMedia(guestPage)]);
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
      await replacementPage.getByRole('button', { name: 'Back to room setup' }).click();
      await expect(replacementPage).toHaveURL('/');
    });

    await test.step('the guest leaves and a replacement peer joins', async () => {
      await guestPage.getByRole('button', { name: 'Leave call' }).click();
      await expect(guestPage).toHaveURL('/');
      await expectWaitingForPeer(page);

      await joinRoom(replacementPage, roomId);
      await Promise.all([expectConnected(page), expectConnected(replacementPage)]);
      await Promise.all([
        expectLocalAndRemoteMedia(page),
        expectLocalAndRemoteMedia(replacementPage),
      ]);
    });

    await test.step('both remaining peers leave the room', async () => {
      await page.getByRole('button', { name: 'Leave call' }).click();
      await expect(page).toHaveURL('/');
      await expectWaitingForPeer(replacementPage);

      await replacementPage.getByRole('button', { name: 'Leave call' }).click();
      await expect(replacementPage).toHaveURL('/');
    });
  } finally {
    await Promise.all([guestContext.close(), replacementContext.close()]);
  }
});

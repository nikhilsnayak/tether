import { expect, type Browser, type Page } from '@playwright/test';

export const expectConnected = (page: Page) =>
  expect(page.getByText('Connected', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

export const expectWaitingForPeer = (page: Page) =>
  expect(page.getByText('Share this room to invite someone.')).toBeVisible();

export const joinRoom = async (page: Page, roomId: string) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Room code' }).fill(roomId);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${roomId}$`));
};

export const createRoom = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page).toHaveURL(/\/room\/[a-z]{3}-[a-z]{4}-[a-z]{3}\?invite=true$/);
  await page.getByRole('button', { name: 'Close' }).click();
  await expectWaitingForPeer(page);
  const roomId = page.url().split('/').at(-1);
  if (roomId === undefined) {
    throw new Error('Expected the generated meeting URL to contain a room id');
  }
  return roomId;
};

export const connectPeers = async (browser: Browser, baseURL: string) => {
  const hostContext = await browser.newContext({ baseURL });
  const guestContext = await browser.newContext({ baseURL });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const roomId = await createRoom(host);
  await joinRoom(guest, roomId);
  await Promise.all([expectConnected(host), expectConnected(guest)]);

  return {
    host,
    guest,
    roomId,
    cleanup: () => Promise.all([hostContext.close(), guestContext.close()]),
  };
};

export const requireBaseURL = (baseURL: string | undefined) => {
  if (typeof baseURL !== 'string') {
    throw new Error('This E2E test requires a configured baseURL');
  }
  return baseURL;
};

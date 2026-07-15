import { expect, test, type Page } from './fixtures';

const sendMessage = async (sender: Page, recipient: Page, message: string) => {
  await Promise.all([
    sender.getByRole('button', { name: 'Open chat' }).click(),
    recipient.getByRole('button', { name: 'Open chat' }).click(),
  ]);
  const input = sender.getByRole('textbox', { name: 'Message' });
  await input.fill(message);
  await input.press('Enter');
  await expect(
    recipient.getByRole('list', { name: 'Chat messages' }).getByText(message),
  ).toBeVisible();
};

test('the Google public STUN configuration reaches the browser', async ({ room }) => {
  const { guest } = await room.connect({ probeWebRtc: true });
  const iceServers = await guest.probe.iceServers();

  expect(iceServers).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
});

test('candidate failures and signal bursts do not terminate the call', async ({ room }) => {
  const burstSize = 100;
  const { host, guest } = await room.connect({ probeWebRtc: true });
  const baselineCandidateCalls = await guest.probe.addIceCandidateCalls();
  await guest.probe.rejectNextIceCandidate();
  await host.probe.emitIceCandidateBurst(burstSize);

  await expect.poll(() => guest.probe.rejectedIceCandidates()).toBe(1);
  await expect
    .poll(() => guest.probe.addIceCandidateCalls())
    .toBeGreaterThan(baselineCandidateCalls);
  await Promise.all([room.expectConnected(host), room.expectConnected(guest)]);
  await sendMessage(host.page, guest.page, 'still connected after signal pressure');
  const deliveredCandidateCalls =
    (await guest.probe.addIceCandidateCalls()) - baselineCandidateCalls;
  expect(deliveredCandidateCalls).toBeLessThan(burstSize);
});

test('leaving a call and joining a new room starts with clean media', async ({ room }) => {
  const { guest } = await room.connect({ probeWebRtc: true });
  const { page } = guest;
  await page.getByRole('button', { name: 'Leave call' }).click();
  await expect(page).toHaveURL('/');

  // Create a fresh room via the Call button (SPA navigation) so the probe
  // keeps both scoped streams. A lone waiting peer now only exists as a host.
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page).toHaveURL(/\/host$/);
  await room.startHostingRoom(guest);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Share this room to invite someone.')).toBeVisible();

  // No stale remote frame from the previous call may survive the rejoin.
  await expect(page.locator('[data-room-media-tile="remote"]')).toHaveCount(0);
  await expect(page.getByLabel('Local video preview')).toBeVisible();
  const streamStates = await guest.probe.localStreamStates();
  // Each room entry acquires one stream that moves from preview into the call.
  // Leaving must stop the prior room's stream while the new host stream stays live.
  expect(streamStates).toEqual(['ended', 'live']);
});

test('a closed room-events channel disables room events without interrupting media', async ({
  room,
}) => {
  test.setTimeout(90_000);
  const { host, guest } = await room.connect({ probeWebRtc: true });
  const hostPage = host.page;
  const guestPage = guest.page;
  const initialHostConnections = await host.probe.peerConnectionCount();
  const initialGuestConnections = await guest.probe.peerConnectionCount();
  const safetyCode = (page: Page) => page.getByLabel('Safety code');
  await Promise.all([
    expect(safetyCode(hostPage)).toBeVisible(),
    expect(safetyCode(guestPage)).toBeVisible(),
  ]);
  const [hostCode, guestCode] = await Promise.all([
    safetyCode(hostPage).textContent(),
    safetyCode(guestPage).textContent(),
  ]);
  expect(hostCode).toBe(guestCode);

  await sendMessage(hostPage, guestPage, 'message before room events close');
  const hostInput = hostPage.getByRole('textbox', { name: 'Message' });
  const guestInput = guestPage.getByRole('textbox', { name: 'Message' });

  await guest.probe.closeLatestDataChannel();

  await Promise.all([expect(hostInput).toBeDisabled(), expect(guestInput).toBeDisabled()]);
  await Promise.all([
    expect(hostPage.locator('[data-room-avatar-sync]')).toHaveAttribute(
      'data-room-avatar-sync',
      'unavailable',
    ),
    expect(guestPage.locator('[data-room-avatar-sync]')).toHaveAttribute(
      'data-room-avatar-sync',
      'unavailable',
    ),
  ]);
  await Promise.all([room.expectConnected(host), room.expectConnected(guest)]);
  await Promise.all([
    expect(hostPage.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-remote-avatar',
      'present',
    ),
    expect(guestPage.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-display',
      'idle',
    ),
  ]);
  await Promise.all([
    expect(hostPage.locator('[data-room-media-tile="remote"]')).toBeVisible(),
    expect(guestPage.locator('[data-room-media-tile="remote"]')).toBeVisible(),
  ]);
  expect(await host.probe.peerConnectionCount()).toBe(initialHostConnections);
  expect(await guest.probe.peerConnectionCount()).toBe(initialGuestConnections);
  await expect(safetyCode(hostPage)).toHaveText(hostCode ?? '');
  await expect(safetyCode(guestPage)).toHaveText(guestCode ?? '');
});

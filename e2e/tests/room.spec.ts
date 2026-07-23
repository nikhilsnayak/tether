import { expect, test, type Page } from './fixtures';
import type { RoomActor } from './support/room-driver';

const CI = !!process.env.CI;
const REAL_RENDER_MEDIA_TIMEOUT = 30_000;

const ROOM_CANVAS_KEY = '__tetherE2ERoomCanvas';

const roomCanvas = (actor: RoomActor) =>
  actor.page.getByLabel('Dusk Suite room scene').locator('canvas');

// Pin the live Canvas DOM object in the page realm so a later phase can prove it
// is the same node, not a fast replacement carrying identical attributes.
const rememberRoomCanvas = async (actor: RoomActor) => {
  const canvas = roomCanvas(actor);
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();
  await canvas.evaluate((node, key) => Reflect.set(window, key, node), ROOM_CANVAS_KEY);
};

const expectSameRoomCanvas = async (actor: RoomActor) => {
  const canvas = roomCanvas(actor);
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();
  expect(
    await canvas.evaluate((node, key) => node === Reflect.get(window, key), ROOM_CANVAS_KEY),
  ).toBe(true);
};

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

const expectLocalAndRemoteMedia = async (page: Page) => {
  await expect(page.getByLabel('Local video preview')).toBeVisible();
  const remoteVideo = page.getByLabel('Other person video');
  if (CI) {
    // SwiftShader can starve Chromium's fake camera frames while the received
    // track remains live and attached. Track assertions below retain the stable
    // WebRTC contract without requiring fake pixels from the CI renderer.
    await expect(remoteVideo).toBeAttached();
  } else {
    await expect(remoteVideo).toBeVisible({ timeout: REAL_RENDER_MEDIA_TIMEOUT });
  }
  await expect
    .poll(() => remoteVideo.evaluate((video: HTMLVideoElement) => video.muted))
    .toBe(true);
  await expect(page.getByLabel('Remote audio')).toBeAttached();
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

test('host and guest complete a real room journey', async ({ page, room }) => {
  test.setTimeout(180_000);
  const host = await room.actorFor(page, { probeWebRtc: true });
  const guest = await room.createActor({ probeWebRtc: true });
  // Capture each Canvas at media setup, before the transfer that requests a
  // session, so the post-connection identity check spans that transition.
  const roomId = await room.createRoom(host, rememberRoomCanvas);

  await room.join(guest, roomId, 'Guest', rememberRoomCanvas);
  await expect(page.getByRole('region', { name: 'Join request' })).toBeVisible();
  await room.admit(host);
  await Promise.all([room.expectConnected(host), room.expectConnected(guest)]);
  await Promise.all([
    expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-journey',
      'together',
    ),
    // GitHub's SwiftShader runner cannot reliably advance two concurrent R3F
    // frame loops, so the guest's spatial transition never completes there.
    // Everything else in this test (connection, media, chat, leave) does not
    // depend on the guest's render loop and still runs in CI.
    ...(CI
      ? []
      : [
          expect(guest.page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
            'data-room-location',
            'inside',
          ),
        ]),
    expectLocalAndRemoteMedia(page),
    expectLocalAndRemoteMedia(guest.page),
    room.expectPreparedMediaTransferred(host),
    room.expectPreparedMediaTransferred(guest),
  ]);
  await expect.poll(() => guest.probe.dataChannelLabels()).toContain('room-events-v1');
  await room.expectRendererReady(host);
  if (!CI) await room.expectRendererReady(guest);

  // The scene must be the exact same Canvas the actor saw at media setup: one
  // renderer survived the media-setup -> session transition, no remount.
  await expectSameRoomCanvas(host);
  await expectSameRoomCanvas(guest);

  await Promise.all([room.expectDetached(host), room.expectDetached(guest)]);
  await Promise.all([room.expectZeroServerSockets(host), room.expectZeroServerSockets(guest)]);
  await Promise.all([
    expect(page.getByTestId('direct-indicator')).toBeVisible(),
    expect(guest.page.getByTestId('direct-indicator')).toBeVisible(),
  ]);

  // Peer-verification contract: both peers must show the same well-formed
  // safety code before either confirms it.
  const [hostCode, guestCode] = await Promise.all([
    page.getByLabel('Safety code').textContent(),
    guest.page.getByLabel('Safety code').textContent(),
  ]);
  expect(hostCode).toMatch(/^\d{5}( \d{5}){4}$/);
  expect(hostCode).toBe(guestCode);

  await Promise.all([
    page.getByRole('button', { name: 'We see the same code' }).click(),
    guest.page.getByRole('button', { name: 'We see the same code' }).click(),
  ]);

  // Watch Together: share a video on the 3D room display over the direct
  // connection. The guest must decode the shared frames, and neither peer may
  // renegotiate the connection to carry the program media.
  const negotiationBefore = await Promise.all([
    host.probe.negotiationNeededCount(),
    guest.probe.negotiationNeededCount(),
  ]);
  await Promise.all([room.expectWatchState(host, 'idle'), room.expectWatchState(guest, 'idle')]);
  await room.startWatch(host);
  await Promise.all([
    room.expectWatchState(host, 'loaded-paused'),
    room.expectWatchState(guest, 'loaded-paused'),
  ]);
  await page.getByRole('button', { name: 'Watch together' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await Promise.all([
    room.expectWatchState(host, 'playing'),
    room.expectWatchState(guest, 'playing'),
  ]);
  await expect
    .poll(() => guest.probe.hasDecodedDetachedVideoFrame(), { timeout: 30_000 })
    .toBe(true);
  await host.page.getByRole('button', { name: 'Stop', exact: true }).click();
  await Promise.all([room.expectWatchState(host, 'idle'), room.expectWatchState(guest, 'idle')]);
  expect(await host.probe.negotiationNeededCount()).toBe(negotiationBefore[0]);
  expect(await guest.probe.negotiationNeededCount()).toBe(negotiationBefore[1]);

  await Promise.all([
    page.getByRole('button', { name: 'Open chat' }).click(),
    guest.page.getByRole('button', { name: 'Open chat' }).click(),
  ]);
  const message = 'Hello across the real data channel';
  await sendMessage(page, message);
  await expect(
    guest.page.getByRole('list', { name: 'Chat messages' }).getByText(message),
  ).toBeVisible();
  await guest.page.keyboard.press('Escape');
  await expect(guest.page.getByRole('dialog', { name: 'Chat' })).toHaveAttribute('data-closed', '');

  // SwiftShader can starve the drawer's exit transition after it has closed,
  // leaving its overlay mounted over the call dock. Dispatching the click
  // still exercises the button handler without waiting for that paint.
  await guest.page.getByRole('button', { name: 'Leave call' }).dispatchEvent('click');
  await expect(guest.page).toHaveURL('/');
  await room.expectPeerDeparted(host);
});

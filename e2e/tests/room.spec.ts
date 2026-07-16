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

const localTrackEnabled = (page: Page, kind: 'audio' | 'video') =>
  page.getByLabel('Local video preview').evaluate((video: HTMLVideoElement, trackKind) => {
    const stream = video.srcObject;
    return stream instanceof MediaStream
      ? (stream.getTracks().find((track) => track.kind === trackKind)?.enabled ?? null)
      : null;
  }, kind);

const expectLocalAndRemoteMedia = async (page: Page) => {
  await expect(page.getByLabel('Local video preview')).toBeVisible();
  await expect(page.getByLabel('Other person video')).toBeVisible({
    timeout: REAL_RENDER_MEDIA_TIMEOUT,
  });
  await expect
    .poll(() =>
      page.getByLabel('Other person video').evaluate((video: HTMLVideoElement) => video.muted),
    )
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

const mediaTilesAvoidToolbar = (page: Page) =>
  page.evaluate(() => {
    const toolbar = document.querySelector('[data-call-dock]')?.getBoundingClientRect();
    const tiles = [...document.querySelectorAll('[data-room-media-tile]')].map((element) =>
      element.getBoundingClientRect(),
    );
    if (toolbar === undefined || tiles.length !== 2) return false;
    const overlaps = (left: DOMRect, right: DOMRect) =>
      left.left < right.right &&
      left.right > right.left &&
      left.top < right.bottom &&
      left.bottom > right.top;
    return !tiles.some((tile) => overlaps(tile, toolbar)) && !overlaps(tiles[0]!, tiles[1]!);
  });

const lowQualityMedianFps = async (page: Page) => {
  await page.getByRole('button', { name: 'Room quality' }).click();
  await page.getByRole('menuitemradio', { name: 'Low quality' }).click();

  // FPS is a time-based renderer contract, so a fixed sampling window is
  // intentional here. Functional E2E scenarios use observable state instead.
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

test.describe('real room', { tag: '@gpu' }, () => {
  test(
    'host and guest complete a real room journey',
    { tag: '@real-render-smoke' },
    async ({ page, room }) => {
      test.setTimeout(90_000);
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
      await expect.poll(() => guest.probe.latestDataChannelLabel()).toBe('room-events-v1');
      await Promise.all([room.expectRendererReady(host), room.expectRendererReady(guest)]);

      // The scene must be the exact same Canvas the actor saw at media setup: one
      // renderer survived the media-setup -> session transition, no remount.
      await expectSameRoomCanvas(host);
      await expectSameRoomCanvas(guest);

      await Promise.all([room.expectDetached(host), room.expectDetached(guest)]);
      await Promise.all([room.expectZeroServerSockets(host), room.expectZeroServerSockets(guest)]);

      await Promise.all([
        page.getByRole('button', { name: 'We see the same code' }).click(),
        guest.page.getByRole('button', { name: 'We see the same code' }).click(),
      ]);
      await Promise.all([
        page.getByRole('button', { name: 'Open chat' }).click(),
        guest.page.getByRole('button', { name: 'Open chat' }).click(),
      ]);
      const message = 'Hello across the real data channel';
      await sendMessage(page, message);
      await expect(
        guest.page.getByRole('list', { name: 'Chat messages' }).getByText(message),
      ).toBeVisible();
      await guest.page.getByRole('button', { name: 'Close' }).click();

      await guest.page.getByRole('button', { name: 'Leave call' }).click();
      await expect(guest.page).toHaveURL('/');
      await room.expectPeerDeparted(host);
    },
  );

  test('local media controls synchronize remote state', async ({ room }) => {
    const { host, guest } = await room.connect();
    const hostPage = host.page;
    const guestPage = guest.page;

    await expect.poll(() => localTrackEnabled(hostPage, 'video')).toBe(true);
    await hostPage.getByRole('button', { name: 'Turn camera off' }).click();
    await expect.poll(() => localTrackEnabled(hostPage, 'video')).toBe(false);
    await expect(guestPage.locator('[data-room-remote-camera]')).toHaveAttribute(
      'data-room-remote-camera',
      'off',
    );
    await expect(guestPage.getByLabel('Other person camera unavailable')).toBeVisible();
    await hostPage.getByRole('button', { name: 'Turn camera on' }).click();
    await expect.poll(() => localTrackEnabled(hostPage, 'video')).toBe(true);
    await expect(guestPage.locator('[data-room-remote-camera]')).toHaveAttribute(
      'data-room-remote-camera',
      'on',
      { timeout: REAL_RENDER_MEDIA_TIMEOUT },
    );

    await expect.poll(() => localTrackEnabled(hostPage, 'audio')).toBe(true);
    await hostPage.getByRole('button', { name: 'Mute microphone' }).click();
    await expect.poll(() => localTrackEnabled(hostPage, 'audio')).toBe(false);
    await expect(guestPage.locator('[data-room-remote-microphone]')).toHaveAttribute(
      'data-room-remote-microphone',
      'off',
    );
    await hostPage.getByRole('button', { name: 'Unmute microphone' }).click();
    await expect.poll(() => localTrackEnabled(hostPage, 'audio')).toBe(true);
    await expect(guestPage.locator('[data-room-remote-microphone]')).toHaveAttribute(
      'data-room-remote-microphone',
      'on',
      { timeout: REAL_RENDER_MEDIA_TIMEOUT },
    );
  });

  test('a detached room code cannot admit a replacement after departure', async ({ room }) => {
    const { host, guest, roomId } = await room.connect();
    await Promise.all([room.expectDetached(host), room.expectDetached(guest)]);
    await guest.page.getByRole('button', { name: 'Leave call' }).click();
    await room.expectPeerDeparted(host);

    const replacement = await room.createActor();
    await replacement.page.goto(`/room/${roomId}`);
    await replacement.page.getByRole('button', { name: 'Join in this browser' }).click();
    await expect(
      replacement.page.getByText('This room is no longer here', { exact: true }),
    ).toBeVisible();
  });

  test('each peer controls only its own physical avatar', async ({ room }) => {
    test.skip(CI, 'GitHub SwiftShader does not reliably advance two R3F frame loops');
    const { host, guest } = await room.connect();
    const hostScene = host.page.getByLabel('Dusk Suite room scene');
    const guestScene = guest.page.getByLabel('Dusk Suite room scene');
    await Promise.all([
      host.page.emulateMedia({ reducedMotion: 'reduce' }),
      guest.page.emulateMedia({ reducedMotion: 'reduce' }),
    ]);
    await Promise.all([
      expect(hostScene).toHaveAttribute('data-room-location', 'inside'),
      expect(guestScene).toHaveAttribute('data-room-location', 'inside'),
      expect(hostScene).toHaveAttribute('data-room-avatar-sync', 'ready'),
      expect(guestScene).toHaveAttribute('data-room-avatar-sync', 'ready'),
      expect(hostScene).toHaveAttribute('data-room-local-pose', /.+/),
      expect(guestScene).toHaveAttribute('data-room-local-pose', /.+/),
    ]);
    const hostBefore = await hostScene.getAttribute('data-room-local-pose');
    const guestBefore = await guestScene.getAttribute('data-room-local-pose');

    await host.page.keyboard.down('w');
    try {
      await expect.poll(() => hostScene.getAttribute('data-room-local-pose')).not.toBe(hostBefore);
    } finally {
      await host.page.keyboard.up('w');
    }
    // The keyup needs a frame to reach the game loop, so wait for the avatar to
    // settle before snapshotting its resting pose, or a still-decelerating
    // frame gets captured as "after" and the later equality check flakes.
    await expect.poll(() => hostScene.getAttribute('data-room-local-pose')).toMatch(/,idle$/);
    await expect.poll(() => guestScene.getAttribute('data-room-remote-pose')).not.toBeNull();
    expect(await guestScene.getAttribute('data-room-local-pose')).toBe(guestBefore);

    const hostAfter = await hostScene.getAttribute('data-room-local-pose');
    await guest.page.keyboard.down('ArrowUp');
    try {
      await expect
        .poll(() => guestScene.getAttribute('data-room-local-pose'))
        .not.toBe(guestBefore);
    } finally {
      await guest.page.keyboard.up('ArrowUp');
    }
    expect(await hostScene.getAttribute('data-room-local-pose')).toBe(hostAfter);
  });

  test('responsive media tiles avoid controls and low quality sustains 30 FPS', async ({
    room,
  }) => {
    test.skip(CI, 'Hardware renderer performance remains a local acceptance contract');
    test.setTimeout(90_000);
    const { host } = await room.connect();

    try {
      for (const viewport of [
        { width: 1_280, height: 720 },
        { width: 390, height: 844 },
      ]) {
        await host.page.setViewportSize(viewport);
        await expect.poll(() => mediaTilesAvoidToolbar(host.page)).toBe(true);
        expect(await lowQualityMedianFps(host.page)).toBeGreaterThanOrEqual(30);
      }
    } finally {
      await host.page.setViewportSize({ width: 1_280, height: 720 });
    }
  });

  test('denying a knock keeps the host inside and the guest outside', async ({ page, room }) => {
    const host = await room.actorFor(page, { probeWebRtc: true });
    const guest = await room.createActor({ probeWebRtc: true });
    const roomId = await room.createRoom(host);
    await room.join(guest, roomId, 'Uninvited guest');
    await expect(page.getByRole('region', { name: 'Join request' })).toBeVisible();
    await room.deny(host);

    await expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-journey',
      'waiting',
    );
    await expect(page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-remote-avatar',
      'absent',
    );
    await expect(guest.page.getByText('Request declined', { exact: true }).first()).toBeVisible();
    await expect(guest.page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-journey',
      'ended',
    );
  });
});

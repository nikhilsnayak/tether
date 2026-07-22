import { expect, test } from './fixtures';

test(
  'two detached peers share a video on the 3D room display',
  { tag: '@gpu' },
  async ({ room }) => {
    const { host, guest } = await room.connect({ probeWebRtc: true });
    await Promise.all([room.expectWatchState(host, 'idle'), room.expectWatchState(guest, 'idle')]);
    await Promise.all([room.expectDetached(host), room.expectDetached(guest)]);
    const negotiationCounts = await Promise.all([
      host.probe.negotiationNeededCount(),
      guest.probe.negotiationNeededCount(),
    ]);

    await room.startWatch(host);
    await Promise.all([
      room.expectWatchState(host, 'loaded-paused'),
      room.expectWatchState(guest, 'loaded-paused'),
    ]);
    const hostScene = host.page.getByLabel('Dusk Suite room scene');
    const guestScene = guest.page.getByLabel('Dusk Suite room scene');
    await Promise.all([
      expect(hostScene).toHaveAttribute('data-room-camera-mode', 'watch'),
      expect(guestScene).toHaveAttribute('data-room-camera-mode', 'watch'),
    ]);
    await hostScene.dispatchEvent('wheel', { deltaY: 100 });
    await expect(hostScene).toHaveAttribute('data-room-camera-mode', 'avatar');
    await host.page.keyboard.press('r');
    await expect(hostScene).toHaveAttribute('data-room-camera-mode', 'watch');
    await host.page.getByRole('button', { name: 'Watch together' }).click();
    await host.page.getByRole('button', { name: 'Play', exact: true }).click();
    await Promise.all([
      room.expectWatchState(host, 'playing'),
      room.expectWatchState(guest, 'playing'),
    ]);
    await expect.poll(() => guest.probe.hasDecodedDetachedVideoFrame()).toBe(true);
    await guest.page.getByRole('button', { name: 'Watch together' }).click();
    await guest.page.getByRole('button', { name: 'Pause', exact: true }).click();
    await Promise.all([
      room.expectWatchState(host, 'loaded-paused'),
      room.expectWatchState(guest, 'loaded-paused'),
    ]);
    await host.page.getByRole('button', { name: 'Stop', exact: true }).click();
    await Promise.all([room.expectWatchState(host, 'idle'), room.expectWatchState(guest, 'idle')]);
    await Promise.all([
      expect(hostScene).toHaveAttribute('data-room-camera-mode', 'avatar'),
      expect(guestScene).toHaveAttribute('data-room-camera-mode', 'avatar'),
    ]);

    expect(await host.probe.negotiationNeededCount()).toBe(negotiationCounts[0]);
    expect(await guest.probe.negotiationNeededCount()).toBe(negotiationCounts[1]);
    await Promise.all([room.expectZeroServerSockets(host), room.expectZeroServerSockets(guest)]);
  },
);

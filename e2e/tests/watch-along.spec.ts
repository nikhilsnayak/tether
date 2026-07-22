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

    expect(await host.probe.negotiationNeededCount()).toBe(negotiationCounts[0]);
    expect(await guest.probe.negotiationNeededCount()).toBe(negotiationCounts[1]);
    await Promise.all([room.expectZeroServerSockets(host), room.expectZeroServerSockets(guest)]);
  },
);

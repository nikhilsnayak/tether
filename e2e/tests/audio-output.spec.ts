import { expect, test } from './fixtures';

test.describe('real room', { tag: '@gpu' }, () => {
  test('audio output menu selects a device and toggles sound off', async ({ room }) => {
    // This scenario deliberately spans a connected call, teardown, and a
    // second host session. SwiftShader can make those two renderer lifecycles
    // exceed the generic GPU-test budget even when every transition succeeds.
    test.slow();

    const hostActor = await room.createActor();
    const guestActor = await room.createActor();
    const { page: host } = hostActor;
    const { page: guest } = guestActor;
    const roomId = await room.createRoom(hostActor);
    const remote = host.getByLabel('Remote audio');
    await expect(remote).toBeAttached();
    const remoteMuted = () => remote.evaluate((audio: HTMLAudioElement) => audio.muted);
    expect(await remoteMuted()).toBe(false);

    await host.getByRole('button', { name: 'Audio output' }).click();
    await expect(host.getByRole('menuitemradio', { name: 'Off' })).toBeVisible();
    await expect(host.getByRole('menuitemradio', { name: 'Fake Audio Output 1' })).toBeVisible();

    await host.getByRole('menuitemradio', { name: 'Fake Audio Output 1' }).click();
    await expect(host.getByRole('menuitemradio', { name: 'Fake Audio Output 1' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await host.getByRole('menuitemradio', { name: 'Off' }).click();
    await expect.poll(remoteMuted).toBe(true);
    await expect(host.getByRole('button', { name: 'Audio output' })).toHaveClass(
      /text-destructive/,
    );

    await expect(host.getByRole('menuitemradio', { name: 'Off' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await host.keyboard.press('Escape');

    await room.join(guestActor, roomId);
    await expect(host.getByRole('region', { name: 'Join request' })).toBeVisible();
    await expect.poll(remoteMuted).toBe(true);
    await expect(host.getByRole('button', { name: 'Audio output' })).toHaveClass(
      /text-destructive/,
    );

    await room.admit(hostActor);
    await Promise.all([room.expectConnected(hostActor), room.expectConnected(guestActor)]);
    await Promise.all([
      host.getByRole('button', { name: 'We see the same code' }).click(),
      guest.getByRole('button', { name: 'We see the same code' }).click(),
    ]);

    await host.getByRole('button', { name: 'Audio output' }).click();
    await expect(host.getByRole('menuitemradio', { name: 'Off' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await host.getByRole('menuitemradio', { name: 'Fake Default Audio Output' }).click();
    await expect.poll(remoteMuted).toBe(false);

    await host.keyboard.press('Escape');

    await host.getByRole('button', { name: 'Audio output' }).click();
    await host.getByRole('menuitemradio', { name: 'Off' }).click();
    await expect.poll(remoteMuted).toBe(true);
    await host.keyboard.press('Escape');

    await host.getByRole('button', { name: 'Leave call' }).click();
    await expect(host).toHaveURL('/');
    await host.getByRole('button', { name: 'Call' }).click();
    await expect(host).toHaveURL(/\/host$/);
    await room.startHostingRoom(hostActor);
    await host.getByRole('button', { name: 'Close' }).click();

    await expect(remote).toBeAttached();
    await expect.poll(remoteMuted).toBe(false);
    await host.getByRole('button', { name: 'Audio output' }).click();
    await expect(
      host.getByRole('menuitemradio', { name: 'Fake Default Audio Output' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});

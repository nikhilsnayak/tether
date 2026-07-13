import { expect, test } from '@playwright/test';

import { admitGuest, createRoom, expectConnected, joinRoom, requireBaseURL } from './helpers';
import { seededStorageState } from './storage-seed';

test('audio output menu selects a device and toggles sound off', async ({ browser }, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const hostContext = await browser.newContext({ baseURL, storageState: seededStorageState });
  const guestContext = await browser.newContext({ baseURL, storageState: seededStorageState });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    const roomId = await createRoom(host);
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

    await joinRoom(guest, roomId);
    await expect(host.getByRole('region', { name: 'Join request' })).toBeVisible();
    await expect.poll(remoteMuted).toBe(true);
    await expect(host.getByRole('button', { name: 'Audio output' })).toHaveClass(
      /text-destructive/,
    );

    await admitGuest(host);
    await Promise.all([expectConnected(host), expectConnected(guest)]);
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
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});

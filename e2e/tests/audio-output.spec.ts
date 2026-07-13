import { expect, test } from '@playwright/test';

import { connectPeers, requireBaseURL } from './helpers';

test('audio output menu selects a device and toggles sound off', async ({ browser }, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { host, cleanup } = await connectPeers(browser, baseURL);
  try {
    const remote = host.getByLabel('Remote audio');
    await expect(remote).toBeAttached();
    const remoteMuted = () => remote.evaluate((audio: HTMLAudioElement) => audio.muted);
    expect(await remoteMuted()).toBe(false);
    await expect(remote).toHaveAttribute('data-audio-route', 'processed');

    await host.getByRole('button', { name: 'Audio output' }).click();
    await expect(host.getByRole('menuitemradio', { name: 'Off' })).toBeVisible();
    await expect(host.getByRole('menuitemradio', { name: 'Fake Audio Output 1' })).toBeVisible();

    await host.getByRole('menuitemradio', { name: 'Fake Audio Output 1' }).click();
    await expect(host.getByLabel('Remote audio')).toHaveAttribute('data-audio-route', 'direct');
    await expect(host.getByRole('menuitemradio', { name: 'Fake Audio Output 1' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await host.getByRole('menuitemradio', { name: 'Off' }).click();
    await expect.poll(remoteMuted).toBe(true);

    await host.getByRole('menuitemradio', { name: 'Fake Default Audio Output' }).click();
    await expect.poll(remoteMuted).toBe(false);
    await expect(host.getByLabel('Remote audio')).toHaveAttribute('data-audio-route', 'processed');

    await host.keyboard.press('Escape');
  } finally {
    await cleanup();
  }
});

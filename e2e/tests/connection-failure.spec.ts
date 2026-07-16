import { expect, test } from './fixtures';

test.describe('real room', { tag: '@gpu' }, () => {
  test('a post-detachment connection failure ends the call and returns to setup', async ({
    room,
  }) => {
    const { host } = await room.connect({ probeWebRtc: true });
    const { page } = host;
    await room.expectDetached(host);
    await host.probe.failLatestPeerConnection();
    await expect(page.getByText('Connection lost', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText('The direct connection failed. Create a new room to reconnect.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Leave call' }).click();
    await expect(page).toHaveURL('/');
  });
});

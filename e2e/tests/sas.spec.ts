import { expect, test, type Page } from '@playwright/test';

import { connectPeers, expectPeerDeparted, requireBaseURL } from './helpers';

test('peers confirm a matching safety code', async ({ browser }, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { host, guest, cleanup } = await connectPeers(browser, baseURL, {
    confirmSafety: false,
    probeWebRtc: true,
  });

  const safetyCode = (page: Page) => page.getByLabel('Safety code');
  const safetyCheck = (page: Page) => page.getByRole('region', { name: 'Safety check' });

  try {
    await expect(safetyCheck(host)).toBeVisible();
    await expect(safetyCheck(guest)).toBeVisible();
    const [hostShowedEarly, guestShowedEarly] = await Promise.all([
      host.evaluate(() => window.__tetherE2E.sasShownBeforeConnected),
      guest.evaluate(() => window.__tetherE2E.sasShownBeforeConnected),
    ]);
    expect(hostShowedEarly).toBe(false);
    expect(guestShowedEarly).toBe(false);

    const [fromHost, fromGuest] = await Promise.all([
      safetyCode(host).textContent(),
      safetyCode(guest).textContent(),
    ]);
    expect(fromHost).toMatch(/^\d{5}( \d{5}){4}$/);
    expect(fromHost).toBe(fromGuest);

    await host.getByRole('button', { name: 'We see the same code' }).click();
    await expect(safetyCheck(host)).toBeHidden();
    // The confirmed code stays visible as a badge.
    await expect(safetyCode(host)).toHaveText(fromHost ?? '');
    await expect(safetyCheck(guest)).toBeVisible();

    // The mismatch escape hatch ends the call. The guest's departure returns the
    // host to the peer-departed waiting state (distinct hint from a fresh room).
    await guest.getByRole('button', { name: "They don't match" }).click();
    await expect(guest).toHaveURL('/');
    await expectPeerDeparted(host);
  } finally {
    await cleanup();
  }
});

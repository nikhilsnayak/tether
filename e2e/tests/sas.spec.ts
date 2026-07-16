import { expect, test, type Page } from './fixtures';

test.describe('real room', { tag: '@gpu' }, () => {
  test('peers confirm a matching safety code', async ({ room }) => {
    const { host, guest } = await room.connect({
      confirmSafety: false,
      probeWebRtc: true,
    });
    const hostPage = host.page;
    const guestPage = guest.page;

    const safetyCode = (page: Page) => page.getByLabel('Safety code');
    const safetyCheck = (page: Page) => page.getByRole('region', { name: 'Safety check' });

    await expect(safetyCheck(hostPage)).toBeVisible();
    await expect(safetyCheck(guestPage)).toBeVisible();
    const [hostShowedEarly, guestShowedEarly] = await Promise.all([
      host.probe.sasShownBeforeConnected(),
      guest.probe.sasShownBeforeConnected(),
    ]);
    expect(hostShowedEarly).toBe(false);
    expect(guestShowedEarly).toBe(false);

    const [fromHost, fromGuest] = await Promise.all([
      safetyCode(hostPage).textContent(),
      safetyCode(guestPage).textContent(),
    ]);
    expect(fromHost).toMatch(/^\d{5}( \d{5}){4}$/);
    expect(fromHost).toBe(fromGuest);

    await hostPage.getByRole('button', { name: 'We see the same code' }).click();
    await expect(safetyCheck(hostPage)).toBeHidden();
    // The confirmed code stays visible as a badge.
    await expect(safetyCode(hostPage)).toHaveText(fromHost ?? '');
    await expect(safetyCheck(guestPage)).toBeVisible();
    await Promise.all([room.expectDetached(host), room.expectDetached(guest)]);

    // The mismatch escape hatch ends the call. The guest's departure returns the
    // host to the ended detached-room state (distinct hint from a fresh room).
    await guestPage.getByRole('button', { name: "They don't match" }).click();
    await expect(guestPage).toHaveURL('/');
    await room.expectPeerDeparted(host);
  });
});

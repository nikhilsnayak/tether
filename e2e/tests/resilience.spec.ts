import { expect, test, type Page } from '@playwright/test';

import { connectPeers, expectConnected, requireBaseURL } from './helpers';

const sendMessage = async (sender: Page, recipient: Page, message: string) => {
  await Promise.all([
    sender.getByRole('button', { name: 'Open chat' }).click(),
    recipient.getByRole('button', { name: 'Open chat' }).click(),
  ]);
  const input = sender.getByRole('textbox', { name: 'Message' });
  await input.fill(message);
  await input.press('Enter');
  await expect(
    recipient.getByRole('list', { name: 'Chat messages' }).getByText(message),
  ).toBeVisible();
};

const emitIceCandidateBurst = (page: Page, count: number) =>
  page.evaluate((candidateCount) => {
    const peerConnection = window.__tetherE2E.peerConnections.at(-1);
    if (peerConnection === undefined) {
      throw new Error('Expected an instrumented peer connection');
    }
    const candidate = new RTCIceCandidate({
      candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 9 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    for (let index = 0; index < candidateCount; index += 1) {
      peerConnection.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate }));
    }
  }, count);

test('server ICE configuration including TURN reaches the browser', async ({
  browser,
}, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { guest, cleanup } = await connectPeers(browser, baseURL, { probeWebRtc: true });
  try {
    const iceServers = await guest.evaluate(
      () => window.__tetherE2E.configurations[0]?.iceServers ?? [],
    );

    expect(iceServers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ urls: ['stun:stun.l.google.com:19302'] }),
        expect.objectContaining({
          credential: 'e2e-turn-password',
          urls: ['turn:127.0.0.1:9?transport=udp'],
          username: 'e2e-turn-user',
        }),
      ]),
    );
  } finally {
    await cleanup();
  }
});

test('candidate failures and signal bursts do not terminate the call', async ({
  browser,
}, testInfo) => {
  const burstSize = 100;
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { host, guest, cleanup } = await connectPeers(browser, baseURL, { probeWebRtc: true });
  try {
    const baselineCandidateCalls = await guest.evaluate(
      () => window.__tetherE2E.addIceCandidateCalls,
    );
    await guest.evaluate(() => {
      window.__tetherE2E.failNextIceCandidate = true;
    });
    await emitIceCandidateBurst(host, burstSize);

    await expect.poll(() => guest.evaluate(() => window.__tetherE2E.rejectedIceCandidates)).toBe(1);
    await expect
      .poll(() => guest.evaluate(() => window.__tetherE2E.addIceCandidateCalls))
      .toBeGreaterThan(baselineCandidateCalls);
    await Promise.all([expectConnected(host), expectConnected(guest)]);
    await sendMessage(host, guest, 'still connected after signal pressure');
    const deliveredCandidateCalls =
      (await guest.evaluate(() => window.__tetherE2E.addIceCandidateCalls)) -
      baselineCandidateCalls;
    expect(deliveredCandidateCalls).toBeLessThan(burstSize);
  } finally {
    await cleanup();
  }
});

test('leaving a call and joining a new room starts with clean media', async ({
  browser,
}, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { guest, cleanup } = await connectPeers(browser, baseURL, { probeWebRtc: true });
  try {
    await guest.getByRole('button', { name: 'Leave call' }).click();
    await expect(guest).toHaveURL('/');

    // Join via the form (SPA navigation) so the probe keeps both streams.
    await guest.getByRole('textbox', { name: 'Room code' }).fill('fresh-after-leave');
    await guest.getByRole('button', { name: 'Connect' }).click();
    await expect(guest.getByText('Share this room to invite someone.')).toBeVisible();

    // No stale remote frame from the previous call may survive the rejoin.
    await expect(guest.getByLabel('Remote video')).toHaveCount(0);
    await expect(guest.getByLabel('Local video preview')).toBeVisible();
    const streamStates = await guest.evaluate(() =>
      window.__tetherE2E.localStreams.map((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended') ? 'ended' : 'live',
      ),
    );
    expect(streamStates).toEqual(['ended', 'live']);
  } finally {
    await cleanup();
  }
});

test('a closed data channel reconnects with fresh peer connections', async ({
  browser,
}, testInfo) => {
  const baseURL = requireBaseURL(testInfo.project.use.baseURL);
  const { host, guest, cleanup } = await connectPeers(browser, baseURL, { probeWebRtc: true });
  try {
    const initialHostConnections = await host.evaluate(
      () => window.__tetherE2E.peerConnections.length,
    );
    const initialGuestConnections = await guest.evaluate(
      () => window.__tetherE2E.peerConnections.length,
    );

    await guest.evaluate(() => {
      const dataChannel = window.__tetherE2E.dataChannels.at(-1);
      if (dataChannel === undefined) {
        throw new Error('Expected an instrumented local data channel');
      }
      dataChannel.close();
    });

    await expect
      .poll(() => host.evaluate(() => window.__tetherE2E.peerConnections.length))
      .toBeGreaterThan(initialHostConnections);
    await expect
      .poll(() => guest.evaluate(() => window.__tetherE2E.peerConnections.length))
      .toBeGreaterThan(initialGuestConnections);
    await Promise.all([expectConnected(host), expectConnected(guest)]);
    await sendMessage(guest, host, 'message after reconnection');
  } finally {
    await cleanup();
  }
});

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

type WebRtcProbe = {
  readonly configurations: RTCConfiguration[];
  readonly dataChannels: RTCDataChannel[];
  readonly localStreams: MediaStream[];
  readonly peerConnections: RTCPeerConnection[];
  addIceCandidateCalls: number;
  failNextIceCandidate: boolean;
  rejectedIceCandidates: number;
  sasShownBeforeConnected: boolean;
};

declare global {
  interface Window {
    __tetherE2E: WebRtcProbe;
  }
}

export const installWebRtcProbe = (context: BrowserContext) =>
  context.addInitScript(() => {
    const probe: WebRtcProbe = {
      configurations: [],
      dataChannels: [],
      localStreams: [],
      peerConnections: [],
      addIceCandidateCalls: 0,
      failNextIceCandidate: false,
      rejectedIceCandidates: 0,
      sasShownBeforeConnected: false,
    };
    window.__tetherE2E = probe;

    const NativePeerConnection = window.RTCPeerConnection;
    const InstrumentedPeerConnection = new Proxy(NativePeerConnection, {
      construct(target, args) {
        const peerConnection = Reflect.construct(target, args) as RTCPeerConnection;
        const configuration = args[0] as RTCConfiguration | undefined;
        probe.peerConnections.push(peerConnection);
        probe.configurations.push(configuration ?? {});

        const nativeAddIceCandidate = peerConnection.addIceCandidate.bind(peerConnection);
        peerConnection.addIceCandidate = (candidate) => {
          probe.addIceCandidateCalls += 1;
          if (probe.failNextIceCandidate) {
            probe.failNextIceCandidate = false;
            probe.rejectedIceCandidates += 1;
            return Promise.reject(new DOMException('Injected ICE candidate failure'));
          }
          return nativeAddIceCandidate(candidate);
        };

        const nativeCreateDataChannel = peerConnection.createDataChannel.bind(peerConnection);
        peerConnection.createDataChannel = (label, options) => {
          const dataChannel = nativeCreateDataChannel(label, options);
          probe.dataChannels.push(dataChannel);
          return dataChannel;
        };

        return peerConnection;
      },
    });
    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true,
      value: InstrumentedPeerConnection,
      writable: true,
    });

    new MutationObserver(() => {
      const safetyCheck = document.querySelector('[aria-label="Safety check"]');
      if (
        safetyCheck !== null &&
        !probe.peerConnections.some(
          (peerConnection) => peerConnection.connectionState === 'connected',
        )
      ) {
        probe.sasShownBeforeConnected = true;
      }
    }).observe(document, { childList: true, subtree: true });

    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await nativeGetUserMedia(constraints);
      probe.localStreams.push(stream);
      return stream;
    };
  });

export const expectConnected = (page: Page) =>
  expect(page.getByText('Connected', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

export const expectWaitingForPeer = (page: Page) =>
  expect(page.getByText('Share this room to invite someone.')).toBeVisible();

export const continueInBrowser = (page: Page) =>
  page.getByRole('button', { name: 'Join in this browser' }).click();

export const joinRoom = async (page: Page, roomId: string) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Room code' }).fill(roomId);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${roomId}$`));
  await continueInBrowser(page);
};

export const createRoom = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page).toHaveURL(/\/room\/[a-z]{3}-[a-z]{4}-[a-z]{3}\?invite=true$/);
  await continueInBrowser(page);
  await page.getByRole('button', { name: 'Close' }).click();
  // Wait for the ?invite=true replace-navigation so the id is extracted clean.
  await expect(page).toHaveURL(/\/room\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  await expectWaitingForPeer(page);
  const roomId = page.url().split('/').at(-1);
  if (roomId === undefined) {
    throw new Error('Expected the generated meeting URL to contain a room id');
  }
  return roomId;
};

export const connectPeers = async (
  browser: Browser,
  baseURL: string,
  options: { readonly probeWebRtc?: boolean } = {},
) => {
  const hostContext = await browser.newContext({ baseURL });
  const guestContext = await browser.newContext({ baseURL });
  if (options.probeWebRtc) {
    await Promise.all([installWebRtcProbe(hostContext), installWebRtcProbe(guestContext)]);
  }
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const roomId = await createRoom(host);
  await joinRoom(guest, roomId);
  await Promise.all([expectConnected(host), expectConnected(guest)]);

  return {
    host,
    guest,
    roomId,
    cleanup: () => Promise.all([hostContext.close(), guestContext.close()]),
  };
};

export const requireBaseURL = (baseURL: string | undefined) => {
  if (typeof baseURL !== 'string') {
    throw new Error('This E2E test requires a configured baseURL');
  }
  return baseURL;
};

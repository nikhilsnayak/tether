import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { seededStorageState } from './storage-seed';

type WebRtcProbe = {
  readonly configurations: RTCConfiguration[];
  readonly dataChannels: RTCDataChannel[];
  readonly localStreams: MediaStream[];
  preflightPreviewStream: MediaStream | null;
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
    if (navigator.mediaDevices === undefined) return;
    const probe: WebRtcProbe = {
      configurations: [],
      dataChannels: [],
      localStreams: [],
      preflightPreviewStream: null,
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
  Promise.all([
    expect(page.getByText('Share this room to invite someone.')).toBeVisible(),
    expect(page.getByLabel('Dusk Suite interactive preview')).toHaveAttribute(
      'data-room-journey',
      'waiting',
    ),
  ]);

// After a peer that had joined leaves, the host stays in the waiting journey but
// shows the peer-departed hint instead of the fresh-room invite prompt.
export const expectPeerDeparted = (page: Page) =>
  Promise.all([
    expect(
      page.getByText('They left the call. You can wait here in case they rejoin.'),
    ).toBeVisible(),
    expect(page.getByLabel('Dusk Suite interactive preview')).toHaveAttribute(
      'data-room-journey',
      'waiting',
    ),
  ]);

export const expectPreparedMediaTransferred = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(() => ({
        acquiredStreams: window.__tetherE2E.localStreams.length,
        actorUsesPreview:
          window.__tetherE2E.preflightPreviewStream !== null &&
          window.__tetherE2E.preflightPreviewStream ===
            document.querySelector<HTMLVideoElement>('video[aria-label="Local video preview"]')
              ?.srcObject,
        previewWasAcquired:
          window.__tetherE2E.preflightPreviewStream === window.__tetherE2E.localStreams[0],
        streamIsLive:
          window.__tetherE2E.localStreams[0]
            ?.getTracks()
            .some((track) => track.readyState === 'live') ?? false,
      })),
    )
    .toEqual({
      acquiredStreams: 1,
      actorUsesPreview: true,
      previewWasAcquired: true,
      streamIsLive: true,
    });

export const continueInBrowser = (page: Page) =>
  page.getByRole('button', { name: 'Join in this browser' }).click();

export const completeMediaSetup = async (page: Page, actionLabel: string) => {
  await expect(page.getByRole('heading', { name: 'Look and sound ready?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const preview = page.getByLabel('Camera preview');
  await expect(preview).toBeVisible();
  await preview.evaluate((video: HTMLVideoElement) => {
    if (window.__tetherE2E !== undefined) {
      window.__tetherE2E.preflightPreviewStream = video.srcObject as MediaStream | null;
    }
  });
  await page.getByRole('button', { name: actionLabel, exact: true }).click();
};

export const startHostingRoom = async (page: Page) => {
  await completeMediaSetup(page, 'Create room');
};

// Joins as a guest: enter the code, continue in-browser, then present a name
// and knock. The host must still admit before the call connects.
export const joinRoom = async (page: Page, roomId: string, displayName = 'Guest') => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Room code' }).fill(roomId);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${roomId}$`));
  await continueInBrowser(page);
  await page.getByRole('textbox', { name: 'Your name' }).fill(displayName);
  await page.getByRole('button', { name: 'Continue to media check' }).click();
  await completeMediaSetup(page, 'Knock to join');
};

export const admitGuest = (host: Page) =>
  host.getByRole('button', { name: 'Allow', exact: true }).click();

export const denyGuest = (host: Page) =>
  host.getByRole('button', { name: 'Deny', exact: true }).click();

// The host mints its room server-side on /host; the id arrives in the invite
// card once the session opens.
export const createRoom = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page).toHaveURL(/\/host$/);
  await startHostingRoom(page);
  const inviteLink = page.getByRole('textbox', { name: 'Room invite link' });
  await expect(inviteLink).toBeVisible({ timeout: 20_000 });
  const url = await inviteLink.inputValue();
  const roomId = url.split('/').at(-1);
  if (roomId === undefined || roomId === '') {
    throw new Error('Expected the invite link to contain a room id');
  }
  await page.getByRole('button', { name: 'Close' }).click();
  await expectWaitingForPeer(page);
  return decodeURIComponent(roomId);
};

export const connectPeers = async (
  browser: Browser,
  baseURL: string,
  options: { readonly confirmSafety?: boolean; readonly probeWebRtc?: boolean } = {},
) => {
  const hostContext = await browser.newContext({ baseURL, storageState: seededStorageState });
  const guestContext = await browser.newContext({ baseURL, storageState: seededStorageState });
  if (options.probeWebRtc) {
    await Promise.all([installWebRtcProbe(hostContext), installWebRtcProbe(guestContext)]);
  }
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const roomId = await createRoom(host);
  await joinRoom(guest, roomId);
  await admitGuest(host);
  await Promise.all([expectConnected(host), expectConnected(guest)]);
  if (options.confirmSafety !== false) {
    await Promise.all([
      host.getByRole('button', { name: 'We see the same code' }).click(),
      guest.getByRole('button', { name: 'We see the same code' }).click(),
    ]);
  }

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

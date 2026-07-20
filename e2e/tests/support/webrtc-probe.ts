import type { BrowserContext, Page } from '@playwright/test';

type WebRtcProbeState = {
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
    __tetherE2E: WebRtcProbeState;
  }
}

export const installWebRtcProbe = (context: BrowserContext) =>
  context.addInitScript(() => {
    if (navigator.mediaDevices === undefined) return;
    const probe: WebRtcProbeState = {
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

export class WebRtcProbe {
  constructor(readonly page: Page) {}

  addIceCandidateCalls() {
    return this.page.evaluate(() => window.__tetherE2E.addIceCandidateCalls);
  }

  allStreamsEnded() {
    return this.page.evaluate(
      () =>
        window.__tetherE2E.localStreams.length > 0 &&
        window.__tetherE2E.localStreams.every((stream) =>
          stream.getTracks().every((track) => track.readyState === 'ended'),
        ),
    );
  }

  closeDataChannel(label: string) {
    return this.page.evaluate((expectedLabel) => {
      const dataChannel = window.__tetherE2E.dataChannels.find(
        (candidate) => candidate.label === expectedLabel,
      );
      if (dataChannel === undefined) {
        throw new Error(`Expected an instrumented ${expectedLabel} data channel`);
      }
      dataChannel.close();
    }, label);
  }

  emitIceCandidateBurst(count: number) {
    return this.page.evaluate((candidateCount) => {
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
  }

  failLatestPeerConnection() {
    return this.page.evaluate(() => {
      const peerConnection = window.__tetherE2E.peerConnections.at(-1);
      if (peerConnection === undefined) {
        throw new Error('Expected an instrumented peer connection');
      }
      Object.defineProperty(peerConnection, 'connectionState', {
        configurable: true,
        value: 'failed',
      });
      peerConnection.dispatchEvent(new Event('connectionstatechange'));
    });
  }

  iceServers() {
    return this.page.evaluate(() => window.__tetherE2E.configurations[0]?.iceServers ?? []);
  }

  dataChannelLabels() {
    return this.page.evaluate(() =>
      window.__tetherE2E.dataChannels.map((dataChannel) => dataChannel.label),
    );
  }

  localStreamCount() {
    return this.page.evaluate(() => window.__tetherE2E.localStreams.length);
  }

  localStreamStates() {
    return this.page.evaluate(() =>
      window.__tetherE2E.localStreams.map((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended') ? 'ended' : 'live',
      ),
    );
  }

  peerConnectionCount() {
    return this.page.evaluate(() => window.__tetherE2E.peerConnections.length);
  }

  preparedMediaState() {
    return this.page.evaluate(() => ({
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
    }));
  }

  previewCleanupState() {
    return this.page.evaluate(() => ({
      acquiredStreams: window.__tetherE2E.localStreams.length,
      previewStopped:
        window.__tetherE2E.localStreams[0]
          ?.getTracks()
          .every((track) => track.readyState === 'ended') ?? false,
    }));
  }

  rememberPreviewStream() {
    return this.page.getByLabel('Camera preview').evaluate((video: HTMLVideoElement) => {
      window.__tetherE2E.preflightPreviewStream = video.srcObject as MediaStream | null;
    });
  }

  rejectedIceCandidates() {
    return this.page.evaluate(() => window.__tetherE2E.rejectedIceCandidates);
  }

  rejectNextIceCandidate() {
    return this.page.evaluate(() => {
      window.__tetherE2E.failNextIceCandidate = true;
    });
  }

  sasShownBeforeConnected() {
    return this.page.evaluate(() => window.__tetherE2E.sasShownBeforeConnected);
  }
}

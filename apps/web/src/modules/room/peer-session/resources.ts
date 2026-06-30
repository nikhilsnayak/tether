/** Scoped WebRTC resources and callback-to-command adapters. */

import { Effect, Queue } from 'effect';

import { CHAT_CHANNEL_LABEL, type BrowserCommand } from './model';

export const acquirePeerConnection = Effect.acquireRelease(
  Effect.sync(
    () =>
      new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      }),
  ),
  (peerConnection) => Effect.sync(() => peerConnection.close()),
);

export const observePeerConnection = Effect.fn('@tether/web/observePeerConnection')(function* (
  peerConnection: RTCPeerConnection,
  queue: Queue.Queue<BrowserCommand>,
) {
  const handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate === null) return;

    Queue.offerUnsafe(queue, {
      _tag: 'LocalIceCandidate',
      candidate: event.candidate.toJSON(),
    });
  };

  const handleDataChannel = (event: RTCDataChannelEvent) => {
    Queue.offerUnsafe(queue, {
      _tag: 'RemoteDataChannel',
      dataChannel: event.channel,
    });
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      peerConnection.addEventListener('icecandidate', handleIceCandidate);
      peerConnection.addEventListener('datachannel', handleDataChannel);
    }),
    () =>
      Effect.sync(() => {
        peerConnection.removeEventListener('icecandidate', handleIceCandidate);
        peerConnection.removeEventListener('datachannel', handleDataChannel);
      }),
  );
});

/**
 * Bridges open and text-message events from an owned chat channel into the
 * actor queue. The immediate open check covers a remotely-created channel that
 * opened before the actor installed its listeners.
 */
export const observeDataChannel = Effect.fn('@tether/web/observeDataChannel')(function* (
  dataChannel: RTCDataChannel,
  queue: Queue.Queue<BrowserCommand>,
) {
  const handleOpen = () => {
    if (dataChannel.readyState !== 'open') return;

    Queue.offerUnsafe(queue, {
      _tag: 'DataChannelOpened',
      dataChannel,
    });
  };

  const handleMessage = (event: MessageEvent<unknown>) => {
    Queue.offerUnsafe(queue, {
      _tag: 'DataChannelMessageReceived',
      dataChannel,
      data: event.data,
    });
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      dataChannel.addEventListener('open', handleOpen);
      dataChannel.addEventListener('message', handleMessage);
    }),
    () =>
      Effect.sync(() => {
        dataChannel.removeEventListener('open', handleOpen);
        dataChannel.removeEventListener('message', handleMessage);
      }),
  );

  handleOpen();
});

export const createChatDataChannel = (peerConnection: RTCPeerConnection) =>
  Effect.sync(() => peerConnection.createDataChannel(CHAT_CHANNEL_LABEL));

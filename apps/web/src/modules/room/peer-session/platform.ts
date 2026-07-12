/** Browser service implementations required by the peer-session runtime. */
import {
  PeerSessionPlatform,
  PlatformError,
  type DataChannelHandle,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PlatformEventDispatch,
} from '@tether/client-runtime/modules/peer-session';
import type { IceServer } from '@tether/client-runtime/modules/peer-session';
import { Crypto, Effect, Layer } from 'effect';

export const webCryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
    // Fresh copy: BufferSource rejects Uint8Array<ArrayBufferLike>.
    digest: (algorithm, data) =>
      Effect.promise(
        async () => new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(data))),
      ),
  }),
);

const peerConnectionValue = (handle: PeerConnectionHandle) => handle.value as RTCPeerConnection;
const dataChannelValue = (handle: DataChannelHandle) => handle.value as RTCDataChannel;
export const mediaStreamValue = (handle: MediaStreamHandle) => handle.value as MediaStream;

const acquireLocalMedia = Effect.acquireRelease(
  Effect.tryPromise({
    try: async (): Promise<MediaStreamHandle> => ({
      value: await navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
    }),
    catch: (cause) => new PlatformError({ operation: 'acquire-local-media', cause }),
  }),
  (handle) =>
    Effect.sync(() => {
      for (const track of mediaStreamValue(handle).getTracks()) {
        track.stop();
      }
    }),
);

const acquirePeerConnection = (iceServers: ReadonlyArray<IceServer>) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => ({
        value: new RTCPeerConnection({
          iceServers: iceServers.map((server) => ({
            urls: [...server.urls],
          })),
        }),
      }),
      catch: (cause) => new PlatformError({ operation: 'acquire-peer-connection', cause }),
    }),
    (peerConnection) =>
      Effect.sync(() => {
        peerConnectionValue(peerConnection).close();
      }),
  );

const observePeerConnection = Effect.fnUntraced(function* (
  peerConnectionHandle: PeerConnectionHandle,
  dispatch: PlatformEventDispatch,
) {
  const peerConnection = peerConnectionValue(peerConnectionHandle);

  const handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate === null) return;

    dispatch({
      _tag: 'LocalIceCandidate',
      peerConnection: peerConnectionHandle,
      candidate: {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        usernameFragment: event.candidate.usernameFragment,
      },
    });
  };

  const handleDataChannel = (event: RTCDataChannelEvent) => {
    dispatch({
      _tag: 'RemoteDataChannel',
      peerConnection: peerConnectionHandle,
      dataChannel: { value: event.channel },
    });
  };

  const handleTrack = (event: RTCTrackEvent) => {
    const stream = event.streams[0];
    if (stream === undefined) return;

    dispatch({
      _tag: 'RemoteTrackReceived',
      peerConnection: peerConnectionHandle,
      stream: { value: stream },
    });
  };

  // Distinguishes the initial connection from a recovery while rejecting
  // duplicate and terminal browser state notifications.
  let observedConnectionState: 'initial' | 'connected' | 'interrupted' | 'failed' = 'initial';
  const handleConnectionStateChange = () => {
    switch (peerConnection.connectionState) {
      case 'failed':
        if (observedConnectionState === 'failed') return;
        observedConnectionState = 'failed';
        dispatch({
          _tag: 'PeerConnectionFailed',
          peerConnection: peerConnectionHandle,
        });
        return;
      case 'disconnected':
        if (observedConnectionState !== 'connected') {
          return;
        }
        observedConnectionState = 'interrupted';
        dispatch({
          _tag: 'PeerConnectionInterrupted',
          peerConnection: peerConnectionHandle,
        });
        return;
      case 'connected':
        if (observedConnectionState === 'connected' || observedConnectionState === 'failed') return;
        if (observedConnectionState === 'initial') {
          observedConnectionState = 'connected';
          dispatch({
            _tag: 'PeerConnectionConnected',
            peerConnection: peerConnectionHandle,
          });
          return;
        }
        observedConnectionState = 'connected';
        dispatch({
          _tag: 'PeerConnectionRestored',
          peerConnection: peerConnectionHandle,
        });
        return;
    }
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      peerConnection.addEventListener('icecandidate', handleIceCandidate);
      peerConnection.addEventListener('datachannel', handleDataChannel);
      peerConnection.addEventListener('track', handleTrack);
      peerConnection.addEventListener('connectionstatechange', handleConnectionStateChange);
    }),
    () =>
      Effect.sync(() => {
        peerConnection.removeEventListener('icecandidate', handleIceCandidate);
        peerConnection.removeEventListener('datachannel', handleDataChannel);
        peerConnection.removeEventListener('track', handleTrack);
        peerConnection.removeEventListener('connectionstatechange', handleConnectionStateChange);
      }),
  );
});

/**
 * Bridges open and text-message events from an owned chat channel into the
 * actor queue. The immediate state checks cover a remotely-created channel that
 * opened before the actor installed its listeners.
 */
const observeDataChannel = Effect.fnUntraced(function* (
  dataChannelHandle: DataChannelHandle,
  dispatch: PlatformEventDispatch,
) {
  const dataChannel = dataChannelValue(dataChannelHandle);

  const handleOpen = () => {
    if (dataChannel.readyState !== 'open') return;

    dispatch({
      _tag: 'DataChannelOpened',
      dataChannel: dataChannelHandle,
    });
  };

  const handleMessage = (event: MessageEvent<unknown>) => {
    dispatch({
      _tag: 'DataChannelMessageReceived',
      dataChannel: dataChannelHandle,
      data: event.data,
    });
  };

  const handleClose = () => {
    if (dataChannel.readyState === 'closed') {
      dispatch({
        _tag: 'DataChannelClosed',
        dataChannel: dataChannelHandle,
      });
    }
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      dataChannel.addEventListener('open', handleOpen);
      dataChannel.addEventListener('message', handleMessage);
      dataChannel.addEventListener('close', handleClose);
    }),
    () =>
      Effect.sync(() => {
        dataChannel.removeEventListener('open', handleOpen);
        dataChannel.removeEventListener('message', handleMessage);
        dataChannel.removeEventListener('close', handleClose);
      }),
  );

  handleOpen();
  handleClose();
});

const webPeerSessionPlatform = PeerSessionPlatform.of({
  acquirePeerConnection,
  acquireLocalMedia,
  addLocalTracks: (peerConnection, localStream) =>
    Effect.try({
      try: () => {
        const stream = mediaStreamValue(localStream);
        for (const track of stream.getTracks()) {
          peerConnectionValue(peerConnection).addTrack(track, stream);
        }
      },
      catch: (cause) => new PlatformError({ operation: 'add-local-tracks', cause }),
    }),
  observePeerConnection,
  createDataChannel: (peerConnection, label) =>
    Effect.try({
      try: () => ({ value: peerConnectionValue(peerConnection).createDataChannel(label) }),
      catch: (cause) => new PlatformError({ operation: 'create-data-channel', cause }),
    }),
  observeDataChannel,
  dataChannelLabel: (dataChannel) => dataChannelValue(dataChannel).label,
  createOffer: (peerConnection) =>
    Effect.tryPromise({
      try: () => peerConnectionValue(peerConnection).createOffer(),
      catch: (cause) => new PlatformError({ operation: 'create-offer', cause }),
    }).pipe(Effect.map(({ sdp }) => ({ type: 'offer' as const, sdp }))),
  createAnswer: (peerConnection) =>
    Effect.tryPromise({
      try: () => peerConnectionValue(peerConnection).createAnswer(),
      catch: (cause) => new PlatformError({ operation: 'create-answer', cause }),
    }).pipe(Effect.map(({ sdp }) => ({ type: 'answer' as const, sdp }))),
  setLocalDescription: (peerConnection, description) =>
    Effect.tryPromise({
      try: () => peerConnectionValue(peerConnection).setLocalDescription(description),
      catch: (cause) => new PlatformError({ operation: 'set-local-description', cause }),
    }),
  setRemoteDescription: (peerConnection, description) =>
    Effect.tryPromise({
      try: () => peerConnectionValue(peerConnection).setRemoteDescription(description),
      catch: (cause) => new PlatformError({ operation: 'set-remote-description', cause }),
    }),
  addIceCandidate: (peerConnection, candidate) =>
    Effect.tryPromise({
      try: () =>
        peerConnectionValue(peerConnection).addIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment,
        }),
      catch: (cause) => new PlatformError({ operation: 'add-ice-candidate', cause }),
    }),
  sendDataChannelMessage: (dataChannel, message) =>
    Effect.try({
      try: () => dataChannelValue(dataChannel).send(message),
      catch: (cause) => new PlatformError({ operation: 'send-message', cause }),
    }),
});

export const webPeerSessionPlatformLayer = Layer.succeed(
  PeerSessionPlatform,
  webPeerSessionPlatform,
);

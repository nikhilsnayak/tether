/** react-native-webrtc adapter exposing native objects as opaque peer-session handles. */
import {
  PeerSessionPlatform,
  PlatformError,
  type DataChannelHandle,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PlatformEventDispatch,
  type IceServer,
  type ProgramTransceiverHandle,
} from '@tether/client-runtime/modules/peer-session';
import { Crypto, Effect, Layer } from 'effect';
import * as ExpoCrypto from 'expo-crypto';
import {
  MediaStream,
  type MediaStreamTrack,
  RTCPeerConnection,
  mediaDevices,
} from 'react-native-webrtc';

export const nativeCryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => ExpoCrypto.getRandomBytes(size),
    // Fresh copy: BufferSource rejects Uint8Array<ArrayBufferLike>.
    digest: (algorithm, data) =>
      Effect.promise(
        async () =>
          new Uint8Array(
            await ExpoCrypto.digest(
              algorithm as ExpoCrypto.CryptoDigestAlgorithm,
              new Uint8Array(data),
            ),
          ),
      ),
  }),
);

// Not exported from the package index.
type RTCDataChannel = ReturnType<RTCPeerConnection['createDataChannel']>;
type RTCRtpTransceiver = ReturnType<RTCPeerConnection['addTransceiver']>;

const peerConnectionValue = (handle: PeerConnectionHandle) => handle.value as RTCPeerConnection;
const dataChannelValue = (handle: DataChannelHandle) => handle.value as RTCDataChannel;
export const mediaStreamValue = (handle: MediaStreamHandle) => handle.value as MediaStream;
const programTransceiverValue = (handle: ProgramTransceiverHandle) =>
  handle.value as { readonly video: RTCRtpTransceiver; readonly audio: RTCRtpTransceiver };

export const acquireLocalMedia = Effect.acquireRelease(
  Effect.tryPromise({
    try: async (): Promise<MediaStreamHandle> => ({
      value: await mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true }),
    }),
    catch: (cause) => new PlatformError({ operation: 'acquire-local-media', cause }),
  }),
  (handle) =>
    Effect.sync(() => {
      const mediaStream = mediaStreamValue(handle);
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }

      mediaStream.release();
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

interface IceCandidateLike {
  readonly candidate: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
}

const observePeerConnection = Effect.fnUntraced(function* (
  peerConnectionHandle: PeerConnectionHandle,
  dispatch: PlatformEventDispatch,
) {
  const peerConnection = peerConnectionValue(peerConnectionHandle);

  const handleIceCandidate = (event: { readonly candidate: IceCandidateLike | null }) => {
    if (event.candidate === null) return;

    dispatch({
      _tag: 'LocalIceCandidate',
      peerConnection: peerConnectionHandle,
      candidate: {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? null,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
        // react-native-webrtc does not expose usernameFragment on candidates.
        usernameFragment: null,
      },
    });
  };

  const handleDataChannel = (event: { readonly channel: RTCDataChannel }) => {
    dispatch({
      _tag: 'RemoteDataChannel',
      peerConnection: peerConnectionHandle,
      dataChannel: { value: event.channel },
    });
  };

  let sharedStream: MediaStream | null = null;
  const handleTrack = (event: {
    readonly streams: ReadonlyArray<MediaStream>;
    readonly track: MediaStreamTrack | null;
  }) => {
    const stream = event.streams[0];
    if (stream !== undefined) {
      dispatch({
        _tag: 'RemoteTrackReceived',
        peerConnection: peerConnectionHandle,
        stream: { value: stream },
      });
      return;
    }
    if (event.track == null) return;

    if (sharedStream === null) sharedStream = new MediaStream([event.track]);
    else sharedStream.addTrack(event.track);
    dispatch({
      _tag: 'RemoteSharedTrackReceived',
      peerConnection: peerConnectionHandle,
      stream: { value: sharedStream },
    });
  };

  const handleIceGatheringStateChange = () => {
    if (peerConnection.iceGatheringState !== 'complete') return;

    dispatch({
      _tag: 'IceGatheringComplete',
      peerConnection: peerConnectionHandle,
    });
  };

  // Distinguishes the initial connection from a recovery while rejecting
  // duplicate and terminal native state notifications.
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
      peerConnection.addEventListener('icegatheringstatechange', handleIceGatheringStateChange);
      peerConnection.addEventListener('connectionstatechange', handleConnectionStateChange);
    }),
    () =>
      Effect.sync(() => {
        peerConnection.removeEventListener('icecandidate', handleIceCandidate);
        peerConnection.removeEventListener('datachannel', handleDataChannel);
        peerConnection.removeEventListener('track', handleTrack);
        peerConnection.removeEventListener(
          'icegatheringstatechange',
          handleIceGatheringStateChange,
        );
        peerConnection.removeEventListener('connectionstatechange', handleConnectionStateChange);
        sharedStream?.release();
        sharedStream = null;
      }),
  );
});

/**
 * Bridges lifecycle and message events from an owned room-events channel into
 * the actor queue. The immediate state checks cover a remotely-created channel
 * that opened before the actor installed its listeners.
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

  const handleMessage = (event: { readonly data: unknown }) => {
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

const nativePeerSessionPlatform = PeerSessionPlatform.of({
  acquirePeerConnection,
  acquireLocalMedia,
  addLocalTracks: (peerConnection, localStream) =>
    Effect.try({
      try: () => {
        const stream = mediaStreamValue(localStream);
        // Native sender encodings expose no priority field, and mobile's
        // program transceivers are recvonly, so there is no supported sender
        // priority knob to apply on this platform.
        for (const track of stream.getTracks()) {
          peerConnectionValue(peerConnection).addTrack(track, stream);
        }
      },
      catch: (cause) => new PlatformError({ operation: 'add-local-tracks', cause }),
    }),
  reserveProgramTransceivers: (peerConnection) =>
    Effect.try({
      try: () => {
        const peer = peerConnectionValue(peerConnection);
        // First-release mobile is a receive-only watcher: it never presents, so
        // its program transceivers do not advertise sending capability.
        return {
          value: {
            video: peer.addTransceiver('video', { direction: 'recvonly' }),
            audio: peer.addTransceiver('audio', { direction: 'recvonly' }),
          },
        };
      },
      catch: (cause) => new PlatformError({ operation: 'reserve-program-transceivers', cause }),
    }),
  replaceProgramTracks: (transceiver, stream) =>
    Effect.tryPromise({
      try: async () => {
        const { video, audio } = programTransceiverValue(transceiver);
        const media = stream === null ? null : mediaStreamValue(stream);
        await Promise.all([
          video.sender.replaceTrack(media?.getVideoTracks()[0] ?? null),
          audio.sender.replaceTrack(media?.getAudioTracks()[0] ?? null),
        ]);
      },
      catch: (cause) => new PlatformError({ operation: 'replace-program-tracks', cause }),
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
      try: () => peerConnectionValue(peerConnection).createOffer({}),
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
        }),
      catch: (cause) => new PlatformError({ operation: 'add-ice-candidate', cause }),
    }),
  sendDataChannelMessage: (dataChannel, message) =>
    Effect.try({
      try: () => dataChannelValue(dataChannel).send(message),
      catch: (cause) => new PlatformError({ operation: 'send-message', cause }),
    }),
});

export const nativePeerSessionPlatformLayer = Layer.succeed(
  PeerSessionPlatform,
  nativePeerSessionPlatform,
);

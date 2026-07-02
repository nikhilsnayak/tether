/**
 * Browser adapter for the platform-neutral peer-session actor.
 *
 * Native WebRTC objects stay in this module. They cross the shared boundary as
 * opaque handles, while DOM events cross it as `PlatformEvent` values. Effect
 * scopes pair every connection/listener acquisition with its cleanup.
 */
import {
  PeerSessionPlatform,
  PlatformError,
  type DataChannelHandle,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PlatformEventDispatch,
} from '@tether/client-runtime/modules/room';
import { IceCandidateSignal } from '@tether/contracts/modules/room';
import { Effect, Layer } from 'effect';

const peerConnectionValue = (handle: PeerConnectionHandle) => handle.value as RTCPeerConnection;
const dataChannelValue = (handle: DataChannelHandle) => handle.value as RTCDataChannel;
const mediaStreamValue = (handle: MediaStreamHandle) => handle.value as MediaStream;

/** Owns the local camera + microphone for as long as the session scope lives. */
const acquireLocalMedia = Effect.acquireRelease(
  Effect.tryPromise({
    try: async (): Promise<MediaStreamHandle> => ({
      value: await navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
    }),
    catch: (cause) => new PlatformError({ operation: 'acquire-local-media', cause }),
  }).pipe(Effect.tap(() => Effect.logInfo('Local media acquired'))),
  (handle) =>
    Effect.gen(function* () {
      for (const track of mediaStreamValue(handle).getTracks()) {
        track.stop();
      }
      yield* Effect.logInfo('Local media released');
    }),
);

/** Owns the native connection for exactly as long as the session scope lives. */
const acquirePeerConnection = Effect.acquireRelease(
  Effect.gen(function* () {
    const peerConnection: PeerConnectionHandle = yield* Effect.try({
      try: () => ({
        value: new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        }),
      }),
      catch: (cause) => new PlatformError({ operation: 'acquire-peer-connection', cause }),
    });
    yield* Effect.logInfo('Peer connection acquired');
    return peerConnection;
  }),
  (peerConnection) =>
    Effect.gen(function* () {
      peerConnectionValue(peerConnection).close();
      yield* Effect.logInfo('Peer connection released');
    }),
);

const observePeerConnection = Effect.fn('@tether/web/observePeerConnection')(function* (
  peerConnectionHandle: PeerConnectionHandle,
  dispatch: PlatformEventDispatch,
) {
  const peerConnection = peerConnectionValue(peerConnectionHandle);

  const handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate === null) return;

    dispatch({
      _tag: 'LocalIceCandidate',
      peerConnection: peerConnectionHandle,
      candidate: new IceCandidateSignal({
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        usernameFragment: event.candidate.usernameFragment,
      }),
    });
  };

  const handleDataChannel = (event: RTCDataChannelEvent) => {
    dispatch({
      _tag: 'RemoteDataChannel',
      peerConnection: peerConnectionHandle,
      dataChannel: { value: event.channel },
    });
  };

  // Tracks whether ICE connectivity has degraded so a return to 'connected' is
  // reported as a restoration rather than the initial connect.
  let interrupted = false;
  const handleConnectionStateChange = () => {
    switch (peerConnection.connectionState) {
      case 'failed':
        dispatch({
          _tag: 'PeerConnectionFailed',
          peerConnection: peerConnectionHandle,
        });
        return;
      case 'disconnected':
        interrupted = true;
        dispatch({
          _tag: 'PeerConnectionInterrupted',
          peerConnection: peerConnectionHandle,
        });
        return;
      case 'connected':
        if (!interrupted) return;
        interrupted = false;
        dispatch({
          _tag: 'PeerConnectionRestored',
          peerConnection: peerConnectionHandle,
        });
        return;
    }
  };

  yield* Effect.acquireRelease(
    Effect.gen(function* () {
      peerConnection.addEventListener('icecandidate', handleIceCandidate);
      peerConnection.addEventListener('datachannel', handleDataChannel);
      peerConnection.addEventListener('connectionstatechange', handleConnectionStateChange);
      yield* Effect.logInfo('Peer connection listeners attached');
    }),
    () =>
      Effect.gen(function* () {
        peerConnection.removeEventListener('icecandidate', handleIceCandidate);
        peerConnection.removeEventListener('datachannel', handleDataChannel);
        peerConnection.removeEventListener('connectionstatechange', handleConnectionStateChange);
        yield* Effect.logInfo('Peer connection listeners detached');
      }),
  );
});

/**
 * Bridges open and text-message events from an owned chat channel into the
 * actor queue. The immediate state checks cover a remotely-created channel that
 * opened before the actor installed its listeners.
 */
const observeDataChannel = Effect.fn('@tether/web/observeDataChannel')(function* (
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
    Effect.gen(function* () {
      dataChannel.addEventListener('open', handleOpen);
      dataChannel.addEventListener('message', handleMessage);
      dataChannel.addEventListener('close', handleClose);
      yield* Effect.logInfo(`Data channel listeners attached: label=${dataChannel.label}`);
    }),
    () =>
      Effect.gen(function* () {
        dataChannel.removeEventListener('open', handleOpen);
        dataChannel.removeEventListener('message', handleMessage);
        dataChannel.removeEventListener('close', handleClose);
        yield* Effect.logInfo(`Data channel listeners detached: label=${dataChannel.label}`);
      }),
  );

  handleOpen();
  handleClose();
});

const webPeerSessionPlatform = PeerSessionPlatform.of({
  acquirePeerConnection,
  acquireLocalMedia,
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

/**
 * Browser adapter for the platform-neutral peer-session actor.
 *
 * Native WebRTC objects stay in this module. They cross the shared boundary as
 * opaque handles, while DOM events cross it as `PlatformEvent` values. Effect
 * scopes pair every connection/listener acquisition with its cleanup.
 */
import {
  PeerSessionPlatform,
  type DataChannelHandle,
  type PeerConnectionHandle,
  type PlatformEventDispatch,
} from '@tether/client-runtime/modules/room';
import { IceCandidateSignal } from '@tether/contracts/modules/room';
import { Effect, Layer } from 'effect';

const peerConnectionValue = (handle: PeerConnectionHandle) => handle.value as RTCPeerConnection;
const dataChannelValue = (handle: DataChannelHandle) => handle.value as RTCDataChannel;

/** Owns the native connection for exactly as long as the session scope lives. */
const acquirePeerConnection = Effect.acquireRelease(
  Effect.gen(function* () {
    const peerConnection: PeerConnectionHandle = {
      value: new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      }),
    };
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

  const handleConnectionStateChange = () => {
    if (peerConnection.connectionState === 'failed') {
      dispatch({
        _tag: 'PeerConnectionFailed',
        peerConnection: peerConnectionHandle,
      });
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
  observePeerConnection,
  createDataChannel: (peerConnection, label) =>
    Effect.sync(() => ({ value: peerConnectionValue(peerConnection).createDataChannel(label) })),
  observeDataChannel,
  dataChannelLabel: (dataChannel) => dataChannelValue(dataChannel).label,
  createOffer: (peerConnection) =>
    Effect.tryPromise(() => peerConnectionValue(peerConnection).createOffer()).pipe(
      Effect.map(({ sdp }) => ({ type: 'offer' as const, sdp })),
    ),
  createAnswer: (peerConnection) =>
    Effect.tryPromise(() => peerConnectionValue(peerConnection).createAnswer()).pipe(
      Effect.map(({ sdp }) => ({ type: 'answer' as const, sdp })),
    ),
  setLocalDescription: (peerConnection, description) =>
    Effect.tryPromise(() => peerConnectionValue(peerConnection).setLocalDescription(description)),
  setRemoteDescription: (peerConnection, description) =>
    Effect.tryPromise(() => peerConnectionValue(peerConnection).setRemoteDescription(description)),
  addIceCandidate: (peerConnection, candidate) =>
    Effect.tryPromise(() =>
      peerConnectionValue(peerConnection).addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment,
      }),
    ),
  sendDataChannelMessage: (dataChannel, message) =>
    Effect.sync(() => dataChannelValue(dataChannel).send(message)),
});

export const webPeerSessionPlatformLayer = Layer.succeed(
  PeerSessionPlatform,
  webPeerSessionPlatform,
);

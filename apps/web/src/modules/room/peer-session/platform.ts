/**
 * Browser adapter for the platform-neutral peer-session actor.
 *
 * Native WebRTC objects stay in this module. They cross the shared boundary as
 * opaque handles, while DOM events cross it as `PlatformCommand` values. Effect
 * scopes pair every connection/listener acquisition with its cleanup.
 */
import {
  PeerSessionPlatform,
  type DataChannelHandle,
  type PeerConnectionHandle,
  type PlatformCommandDispatch,
} from '@tether/client-runtime/modules/room';
import { IceCandidateSignal } from '@tether/contracts/modules/room';
import { Effect, Layer } from 'effect';

const peerConnectionValue = (handle: PeerConnectionHandle) => handle.value as RTCPeerConnection;
const dataChannelValue = (handle: DataChannelHandle) => handle.value as RTCDataChannel;

/** Owns the native connection for exactly as long as the session scope lives. */
const acquirePeerConnection = Effect.acquireRelease(
  Effect.sync(
    (): PeerConnectionHandle => ({
      value: new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      }),
    }),
  ),
  (peerConnection) => Effect.sync(() => peerConnectionValue(peerConnection).close()),
);

const observePeerConnection = Effect.fn('@tether/web/observePeerConnection')(function* (
  peerConnectionHandle: PeerConnectionHandle,
  dispatch: PlatformCommandDispatch,
) {
  const peerConnection = peerConnectionValue(peerConnectionHandle);

  const handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate === null) return;

    dispatch({
      _tag: 'LocalIceCandidate',
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
      dataChannel: { value: event.channel },
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
const observeDataChannel = Effect.fn('@tether/web/observeDataChannel')(function* (
  dataChannelHandle: DataChannelHandle,
  dispatch: PlatformCommandDispatch,
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

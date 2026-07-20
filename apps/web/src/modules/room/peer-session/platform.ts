/** Browser service implementations required by the peer-session runtime. */
import {
  PeerSessionPlatform,
  PlatformError,
  type DataChannelHandle,
  type IceServer,
  type MediaStreamHandle,
  type PeerConnectionHandle,
  type PlatformEventDispatch,
  type ProgramTransceiverHandle,
} from '@tether/client-runtime/modules/peer-session';
import type { PreparedMedia } from '@tether/client-runtime/modules/room';
import { Crypto, Effect, Exit, Layer, Scope } from 'effect';

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
const programTransceiverValue = (handle: ProgramTransceiverHandle) =>
  handle.value as { readonly video: RTCRtpTransceiver; readonly audio: RTCRtpTransceiver };

export type SenderTrafficClass = 'voice-audio' | 'program-audio' | 'program-video';

const senderTuning = {
  'voice-audio': { priority: 'high' },
  'program-audio': { priority: 'medium' },
  'program-video': { priority: 'low', degradationPreference: 'maintain-resolution' },
} as const satisfies Record<
  SenderTrafficClass,
  { readonly priority: RTCPriorityType; readonly degradationPreference?: RTCDegradationPreference }
>;

/** Feature-detects encoding priorities and applies standard degradation preference best-effort. */
export const tuneSenderParameters = (
  parameters: RTCRtpSendParameters,
  trafficClass: SenderTrafficClass,
): boolean => {
  const tuning = senderTuning[trafficClass];
  let changed = false;
  for (const encoding of parameters.encodings) {
    if ('priority' in encoding && encoding.priority !== tuning.priority) {
      encoding.priority = tuning.priority;
      changed = true;
    }
    if ('networkPriority' in encoding && encoding.networkPriority !== tuning.priority) {
      encoding.networkPriority = tuning.priority;
      changed = true;
    }
  }
  if (
    'degradationPreference' in tuning &&
    parameters.degradationPreference !== tuning.degradationPreference
  ) {
    parameters.degradationPreference = tuning.degradationPreference;
    changed = true;
  }
  return changed;
};

const tuneSender = (sender: RTCRtpSender, trafficClass: SenderTrafficClass) =>
  Effect.try(() => {
    const parameters = sender.getParameters();
    return tuneSenderParameters(parameters, trafficClass)
      ? Effect.tryPromise(() => sender.setParameters(parameters))
      : Effect.void;
  }).pipe(Effect.flatten, Effect.ignore);

const replaceSenderTrack = (sender: RTCRtpSender, track: MediaStreamTrack | null) =>
  Effect.tryPromise({
    try: () => sender.replaceTrack(track),
    catch: (cause) => new PlatformError({ operation: 'replace-program-tracks', cause }),
  });

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

export interface PreparedLocalMedia {
  readonly stream: MediaStream;
  readonly cancel: () => Promise<void>;
  readonly transfer: () => PreparedMedia;
}

/**
 * Acquires one preview stream in its own scope. Transfer hands its finalizer to
 * the peer-session media scope on claim; cancel closes it here if it is
 * abandoned before a claim adopts it.
 */
export const prepareLocalMedia = Effect.fn('prepareLocalMedia')(function* () {
  const resourceScope = yield* Scope.make();
  const handle = yield* acquireLocalMedia.pipe(
    Scope.provide(resourceScope),
    Effect.onError(() => Scope.close(resourceScope, Exit.void)),
  );
  let ownership: 'preview' | 'transferred' | 'claimed' | 'released' = 'preview';

  // cancel only reaches here while unclaimed and a claimed stream is torn down
  // once by its adopting scope, so the stream is always released exactly once.
  const close = () => {
    ownership = 'released';
    return Effect.runPromise(Scope.close(resourceScope, Exit.void));
  };

  return {
    stream: mediaStreamValue(handle),
    // Releases the stream while this side still owns it (preview, or transferred
    // but never claimed). Once a claim adopts it, its scope owns the teardown.
    cancel: () =>
      ownership === 'preview' || ownership === 'transferred' ? close() : Promise.resolve(),
    transfer: () => {
      if (ownership !== 'preview') {
        throw new Error('Prepared local media can only be transferred once');
      }
      ownership = 'transferred';
      return {
        claim: Effect.acquireRelease(
          Effect.try({
            try: () => {
              if (ownership !== 'transferred') {
                throw new Error('Prepared local media can only be claimed once');
              }
              ownership = 'claimed';
              return handle;
            },
            catch: (cause) => new PlatformError({ operation: 'acquire-local-media', cause }),
          }),
          () => Effect.promise(close),
        ),
      };
    },
  } satisfies PreparedLocalMedia;
});

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

  // Camera/mic tracks carry their stream. Reserved watch-along tracks do not,
  // so group those into a separate stream for the shared-media projection.
  let sharedStream: MediaStream | null = null;
  const handleTrack = (event: RTCTrackEvent) => {
    const stream = event.streams[0];
    if (stream !== undefined) {
      dispatch({
        _tag: 'RemoteTrackReceived',
        peerConnection: peerConnectionHandle,
        stream: { value: stream },
      });
      return;
    }

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
        return Effect.all(
          stream.getTracks().map((track) => {
            const sender = peerConnectionValue(peerConnection).addTrack(track, stream);
            return track.kind === 'audio' ? tuneSender(sender, 'voice-audio') : Effect.void;
          }),
          { discard: true },
        );
      },
      catch: (cause) => new PlatformError({ operation: 'add-local-tracks', cause }),
    }).pipe(Effect.flatten),
  reserveProgramTransceivers: (peerConnection) =>
    Effect.try({
      try: () => {
        const peer = peerConnectionValue(peerConnection);
        const video = peer.addTransceiver('video', { direction: 'sendrecv' });
        const audio = peer.addTransceiver('audio', { direction: 'sendrecv' });
        const transceivers = { value: { video, audio } };
        return Effect.all(
          [tuneSender(video.sender, 'program-video'), tuneSender(audio.sender, 'program-audio')],
          { concurrency: 'unbounded', discard: true },
        ).pipe(Effect.as(transceivers));
      },
      catch: (cause) => new PlatformError({ operation: 'reserve-program-transceivers', cause }),
    }).pipe(Effect.flatten),
  replaceProgramTracks: (transceiver, stream) =>
    Effect.gen(function* () {
      const { video, audio } = programTransceiverValue(transceiver);
      const media = stream === null ? null : mediaStreamValue(stream);
      const videoTrack = media?.getVideoTracks()[0] ?? null;
      if (videoTrack !== null) videoTrack.contentHint = 'detail';
      yield* Effect.all(
        [tuneSender(video.sender, 'program-video'), tuneSender(audio.sender, 'program-audio')],
        { concurrency: 'unbounded', discard: true },
      );
      yield* Effect.all(
        [
          replaceSenderTrack(video.sender, videoTrack),
          replaceSenderTrack(audio.sender, media?.getAudioTracks()[0] ?? null),
        ],
        { concurrency: 'unbounded', discard: true },
      );
    }),
  observePeerConnection,
  createDataChannel: (peerConnection, label) =>
    Effect.try({
      try: () => ({ value: peerConnectionValue(peerConnection).createDataChannel(label) }),
      catch: (cause) => new PlatformError({ operation: 'create-data-channel', cause }),
    }),
  observeDataChannel,
  dataChannelLabel: (dataChannel) => dataChannelValue(dataChannel).label,
  dataChannelBufferedAmount: (dataChannel) => dataChannelValue(dataChannel).bufferedAmount,
  closeDataChannel: (dataChannel) =>
    Effect.try({
      try: () => dataChannelValue(dataChannel).close(),
      catch: (cause) => new PlatformError({ operation: 'close-data-channel', cause }),
    }),
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

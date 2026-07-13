import { useEffect, useEffectEvent, useRef, useState } from 'react';

import {
  createRoomAudioEngine,
  selectRemoteAudioRoute,
  type RoomAudioEngine,
} from '../scene/room-audio';

interface KnockPlaybackQueue {
  readonly enqueue: (peerIds: ReadonlyArray<string>) => void;
  readonly flush: (play: () => void) => void;
  readonly pause: () => void;
}

function createKnockPlaybackQueue(): KnockPlaybackQueue {
  const knownPeerIds = new Set<string>();
  const queuedPeerIds: Array<string> = [];
  let timer: number | null = null;

  const pause = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  const flush = (play: () => void) => {
    if (timer !== null) return;
    const peerId = queuedPeerIds.shift();
    if (peerId === undefined) return;
    play();
    timer = window.setTimeout(() => {
      timer = null;
      flush(play);
    }, 320);
  };

  return {
    enqueue(peerIds) {
      for (const peerId of peerIds) {
        if (knownPeerIds.has(peerId)) continue;
        knownPeerIds.add(peerId);
        queuedPeerIds.push(peerId);
      }
    },
    flush,
    pause,
  };
}

export function attachRemoteAudio(element: HTMLAudioElement, stream: MediaStream): () => void {
  element.srcObject = stream;
  void element.play().catch(() => {});
  return () => {
    element.pause();
    element.srcObject = null;
  };
}

export function setRemoteAudioSink(element: HTMLAudioElement, sinkId: string): void {
  if (sinkId !== '' && typeof element.setSinkId === 'function') {
    void element.setSinkId(sinkId).catch(() => {});
  }
}

export function RemoteAudio({
  stream,
  sinkId,
  muted,
  pendingJoinPeerIds,
}: {
  readonly stream: MediaStream | null;
  readonly sinkId: string;
  readonly muted: boolean;
  readonly pendingJoinPeerIds: ReadonlyArray<string>;
}) {
  const [activated, setActivated] = useState(false);
  const [processingFailed, setProcessingFailed] = useState(false);
  const [knockQueue] = useState(createKnockPlaybackQueue);
  const audioRef = useRef<HTMLAudioElement>(null);
  const engineRef = useRef<RoomAudioEngine | null>(null);
  const webAudioSupported = typeof AudioContext !== 'undefined' && !processingFailed;
  const route = selectRemoteAudioRoute({ activated, sinkId, webAudioSupported });
  const createEngine = useEffectEvent((element: HTMLAudioElement) => {
    const engine = createRoomAudioEngine(element);
    engine.setMuted(muted);
    return engine;
  });

  useEffect(() => {
    if (activated) return;
    const activate = () => setActivated(true);
    document.addEventListener('pointerdown', activate, { once: true, capture: true });
    document.addEventListener('keydown', activate, { once: true, capture: true });
    return () => {
      document.removeEventListener('pointerdown', activate, { capture: true });
      document.removeEventListener('keydown', activate, { capture: true });
    };
  }, [activated]);

  useEffect(() => {
    const element = audioRef.current;
    if (element === null || stream === null) return;
    return attachRemoteAudio(element, stream);
  }, [route, stream]);

  useEffect(() => {
    const element = audioRef.current;
    if (route === 'direct' && element !== null) setRemoteAudioSink(element, sinkId);
  }, [route, sinkId]);

  useEffect(() => {
    const element = audioRef.current;
    if (route !== 'processed' || element === null) return;
    try {
      const engine = createEngine(element);
      engineRef.current = engine;
      return () => {
        knockQueue.pause();
        engineRef.current = null;
        engine.dispose();
      };
    } catch {
      setProcessingFailed(true);
    }
  }, [route, knockQueue]);

  useEffect(() => {
    engineRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    knockQueue.enqueue(pendingJoinPeerIds);
    const engine = engineRef.current;
    if (engine === null) return;
    knockQueue.flush(() => engine.playKnock());
  }, [activated, knockQueue, pendingJoinPeerIds, route]);

  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- live call audio has no captions
    <audio
      key={route}
      ref={audioRef}
      aria-label='Remote audio'
      autoPlay
      muted={muted}
      data-audio-route={route}
    />
  );
}

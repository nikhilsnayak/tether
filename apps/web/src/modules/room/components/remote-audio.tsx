import { useEffect, useRef, useState } from 'react';

import type { SpatialAudioGraph } from '../audio/spatial-audio-graph';
import { createRoomAudioEngine, type RoomAudioEngine } from '../scene/room-audio';
import { attachAudioStream, setAudioSink } from './audio-element';

export interface KnockPlaybackQueue {
  readonly enqueue: (peerIds: ReadonlyArray<string>) => void;
  readonly flush: (play: () => void) => void;
  readonly pause: () => void;
}

export function createKnockPlaybackQueue(): KnockPlaybackQueue {
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
      const pending = new Set(peerIds);
      // Reconcile against the current knocks: forget peers that are no longer
      // pending so knownPeerIds stays bounded (and a re-knock re-announces), and
      // drop their queued cues so a withdrawn knock never plays.
      for (const peerId of knownPeerIds) {
        if (!pending.has(peerId)) knownPeerIds.delete(peerId);
      }
      const stillPending = queuedPeerIds.filter((peerId) => pending.has(peerId));
      queuedPeerIds.length = 0;
      queuedPeerIds.push(...stillPending);
      // Enqueue newly-pending peers in knock order.
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

export function RemoteAudio({
  stream,
  sinkId,
  muted,
  pendingJoinPeerIds,
  graph,
}: {
  readonly stream: MediaStream | null;
  readonly sinkId: string;
  readonly muted: boolean;
  readonly pendingJoinPeerIds: ReadonlyArray<string>;
  readonly graph: SpatialAudioGraph | null;
}) {
  const [activated, setActivated] = useState(false);
  const [knockQueue] = useState(createKnockPlaybackQueue);
  const audioRef = useRef<HTMLAudioElement>(null);
  const engineRef = useRef<RoomAudioEngine | null>(null);
  // Read at engine creation so a speaker toggled off before the first gesture
  // starts the engine muted, without recreating it on every mute change.
  const mutedRef = useRef(muted);

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
    return attachAudioStream(element, stream);
  }, [stream]);

  // Spatial mode: the audible path is the Web Audio graph; the muted <audio>
  // above stays as the Chrome silence-bug keepalive (§6) — a
  // MediaStreamAudioSourceNode outputs silence unless the same stream is also on
  // a live, playing HTMLMediaElement.
  useEffect(() => {
    if (graph === null || stream === null) return;
    graph.connectVoice(stream);
  }, [graph, stream]);

  // Fallback only: in spatial mode the sink lives on the AudioContext (set by the
  // graph hook), not the element.
  useEffect(() => {
    const element = audioRef.current;
    if (element !== null && graph === null) setAudioSink(element, sinkId);
  }, [graph, sinkId]);

  useEffect(() => {
    if (!activated || typeof AudioContext === 'undefined') return;
    try {
      const engine = createRoomAudioEngine();
      engine.setMuted(mutedRef.current);
      engineRef.current = engine;
      return () => {
        knockQueue.pause();
        engineRef.current = null;
        engine.dispose();
      };
    } catch {
      return;
    }
  }, [activated, knockQueue]);

  useEffect(() => {
    mutedRef.current = muted;
    engineRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    knockQueue.enqueue(pendingJoinPeerIds);
    const engine = engineRef.current;
    if (engine === null) return;
    knockQueue.flush(() => engine.playKnock());
  }, [activated, knockQueue, pendingJoinPeerIds]);

  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- live call audio has no captions
    <audio
      ref={audioRef}
      aria-label='Remote audio'
      autoPlay
      muted={graph !== null ? true : muted}
    />
  );
}

import { useEffect, useRef } from 'react';

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
}: {
  readonly stream: MediaStream | null;
  readonly sinkId: string;
  readonly muted: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = audioRef.current;
    if (element === null || stream === null) return;
    return attachRemoteAudio(element, stream);
  }, [stream]);

  useEffect(() => {
    const element = audioRef.current;
    if (element !== null) setRemoteAudioSink(element, sinkId);
  }, [sinkId]);

  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- live call audio has no captions
    <audio ref={audioRef} aria-label='Remote audio' autoPlay muted={muted} />
  );
}

export function attachAudioStream(element: HTMLAudioElement, stream: MediaStream): () => void {
  element.srcObject = stream;
  void element.play().catch(() => {});
  return () => {
    element.pause();
    element.srcObject = null;
  };
}

export function setAudioSink(element: HTMLAudioElement, sinkId: string): void {
  if (sinkId !== '' && typeof element.setSinkId === 'function') {
    void element.setSinkId(sinkId).catch(() => {});
  }
}

import { VideoTexture } from 'three';

export interface RemoteVideoSurface {
  readonly element: HTMLVideoElement;
  readonly texture: VideoTexture;
  dispose(): void;
}

export function disposeRemoteVideoSurface(
  element: Pick<HTMLVideoElement, 'pause' | 'srcObject'>,
  texture: Pick<VideoTexture, 'dispose'>,
): void {
  element.pause();
  element.srcObject = null;
  texture.dispose();
}

export function createRemoteVideoSurface(stream: MediaStream): RemoteVideoSurface {
  const element = document.createElement('video');
  element.autoplay = true;
  element.muted = true;
  element.playsInline = true;
  element.srcObject = stream;
  void element.play().catch(() => {});
  const texture = new VideoTexture(element);

  return {
    element,
    texture,
    dispose() {
      disposeRemoteVideoSurface(element, texture);
    },
  };
}

export function containedVideoSize(
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
): readonly [width: number, height: number] {
  if (sourceWidth <= 0 || sourceHeight <= 0) return [displayWidth, displayHeight];
  const sourceAspect = sourceWidth / sourceHeight;
  const displayAspect = displayWidth / displayHeight;
  return sourceAspect > displayAspect
    ? [displayWidth, displayWidth / sourceAspect]
    : [displayHeight * sourceAspect, displayHeight];
}

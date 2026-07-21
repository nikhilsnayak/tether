import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useRef, type RefObject } from 'react';
import type { Renderer } from 'three/webgpu';

type RendererBackendStatus = {
  readonly isWebGLBackend?: boolean;
  readonly isWebGPUBackend?: boolean;
  readonly gl?: WebGLRenderingContext;
};

export function FramePerformanceMonitor({
  onSample,
}: {
  readonly onSample: (fps: number) => void;
}) {
  const elapsed = useRef(0);
  const frames = useRef(0);
  useFrame((_, delta) => {
    elapsed.current += delta;
    frames.current += 1;
    if (elapsed.current < 1) return;
    onSample(frames.current / elapsed.current);
    elapsed.current = 0;
    frames.current = 0;
  });
  return null;
}

export function ContextLossGuard({
  updateContextLost,
}: {
  readonly updateContextLost: (lost: true) => void;
}) {
  const { renderer } = useThree();
  const reported = useRef(false);
  useEffect(() => {
    const roomRenderer = renderer as Renderer;
    const canvas = roomRenderer.domElement;
    const previousOnDeviceLost = roomRenderer.onDeviceLost;
    const onDeviceLost: Renderer['onDeviceLost'] = (info) => {
      previousOnDeviceLost.call(roomRenderer, info);
      reported.current = true;
      updateContextLost(true);
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      reported.current = true;
      updateContextLost(true);
    };
    roomRenderer.onDeviceLost = onDeviceLost;
    canvas.addEventListener('webglcontextlost', onContextLost);
    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      if (roomRenderer.onDeviceLost === onDeviceLost) {
        roomRenderer.onDeviceLost = previousOnDeviceLost;
      }
    };
  }, [renderer, updateContextLost]);
  useFrame(() => {
    if (reported.current) return;
    const backend = (renderer as Renderer).backend as RendererBackendStatus | undefined;
    if (backend?.gl?.isContextLost() !== true) return;
    reported.current = true;
    updateContextLost(true);
  });
  return null;
}

export function RendererStatusObserver({
  surfaceRef,
}: {
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const { renderer } = useThree();
  const published = useRef(false);

  useFrame(() => {
    if (published.current) return;
    const surface = surfaceRef.current;
    if (surface === null) return;

    const backend = (renderer as Renderer).backend as RendererBackendStatus | undefined;
    surface.dataset.roomRendererBackend = backend?.isWebGPUBackend
      ? 'webgpu'
      : backend?.isWebGLBackend
        ? 'webgl'
        : 'unknown';
    surface.dataset.roomRendererReady = 'true';
    published.current = true;
  });

  return null;
}

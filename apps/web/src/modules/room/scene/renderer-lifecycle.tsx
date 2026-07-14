import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';

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
  useEffect(() => {
    let active = true;
    const backend = renderer.backend as { readonly device?: GPUDevice };
    if (backend.device !== undefined) {
      void backend.device.lost.then(() => {
        if (active) updateContextLost(true);
      });
    }
    return () => {
      active = false;
    };
  }, [renderer, updateContextLost]);
  return null;
}

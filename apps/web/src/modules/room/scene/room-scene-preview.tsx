import { Canvas, useFrame, useThree } from '@react-three/fiber/webgpu';
import { Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

import { useReducedMotionPreference } from '@/hooks/use-reduced-motion-preference';

import type { RoomTemplate } from '../templates/registry';
import {
  clampLook,
  isQualityPreference,
  QUALITY_CONFIGS,
  QUALITY_STORAGE_KEY,
  type QualityPreference,
  resolveQualityTier,
  selectFraming,
  shouldAnimateCamera,
} from './config';

function CameraRig({
  template,
  reducedMotion,
  surfaceRef,
}: {
  readonly template: RoomTemplate;
  readonly reducedMotion: boolean;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const { camera, size } = useThree();
  const look = useRef({ yaw: 0, pitch: 0 });
  const desiredLook = useRef({ yaw: 0, pitch: 0 });
  const desiredPosition = useRef(new Vector3());
  const lookEuler = useRef(new Euler(0, 0, 0, 'YXZ'));
  const lookOffset = useRef(new Quaternion());
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const lastInteraction = useRef(0);
  const framing = selectFraming(
    size.width,
    size.height,
    template.camera.landscape,
    template.camera.portrait,
  );

  useEffect(() => {
    const element = surfaceRef.current;
    if (element === null) return;

    const pointerDown = (event: PointerEvent) => {
      if ((event.target as Element).closest('[data-room-overlay]') !== null) return;
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
      lastInteraction.current = performance.now();
    };
    const pointerMove = (event: PointerEvent) => {
      const current = drag.current;
      if (current === null || current.pointerId !== event.pointerId) return;
      const bounded = clampLook(
        desiredLook.current.yaw - (event.clientX - current.x) * 0.0028,
        desiredLook.current.pitch - (event.clientY - current.y) * 0.0024,
        template.camera.look,
      );
      desiredLook.current = bounded;
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      lastInteraction.current = performance.now();
    };
    const pointerUp = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) drag.current = null;
    };

    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('pointermove', pointerMove);
    element.addEventListener('pointerup', pointerUp);
    element.addEventListener('pointercancel', pointerUp);
    return () => {
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('pointermove', pointerMove);
      element.removeEventListener('pointerup', pointerUp);
      element.removeEventListener('pointercancel', pointerUp);
    };
  }, [surfaceRef, template]);

  useFrame((_, delta) => {
    if (performance.now() - lastInteraction.current > template.camera.look.recenterAfterMs) {
      desiredLook.current = { yaw: 0, pitch: 0 };
    }

    const animate = shouldAnimateCamera(reducedMotion);
    const alpha = animate ? 1 - Math.exp((-delta * 5) / template.camera.look.recenterSeconds) : 1;
    look.current.yaw = MathUtils.lerp(look.current.yaw, desiredLook.current.yaw, alpha);
    look.current.pitch = MathUtils.lerp(look.current.pitch, desiredLook.current.pitch, alpha);

    desiredPosition.current.set(...framing.position);
    camera.position.lerp(desiredPosition.current, animate ? 1 - Math.exp(-delta * 6) : 1);
    camera.lookAt(...framing.target);
    lookEuler.current.set(look.current.pitch, look.current.yaw, 0, 'YXZ');
    lookOffset.current.setFromEuler(lookEuler.current);
    camera.quaternion.multiply(lookOffset.current);
    if ('fov' in camera && camera.fov !== framing.fieldOfView) {
      camera.fov = framing.fieldOfView;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

function ContextLossGuard({ onLost }: { readonly onLost: () => void }) {
  const { renderer } = useThree();

  useEffect(() => {
    let active = true;
    const backend = renderer.backend as { readonly device?: GPUDevice };
    if (backend.device !== undefined) {
      void backend.device.lost.then(() => {
        if (active) onLost();
      });
    }
    return () => {
      active = false;
    };
  }, [renderer, onLost]);

  return null;
}

function readQualityPreference(): QualityPreference {
  if (typeof localStorage === 'undefined') return 'auto';
  const stored = localStorage.getItem(QUALITY_STORAGE_KEY);
  return isQualityPreference(stored) ? stored : 'auto';
}

export function RoomScenePreview({ template }: { readonly template: RoomTemplate }) {
  const [qualityPreference, setQualityPreference] = useState(readQualityPreference);
  const [contextLost, setContextLost] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotionPreference();
  const qualityTier = resolveQualityTier(
    qualityPreference,
    typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
  );
  const quality = QUALITY_CONFIGS[qualityTier];
  const Scene = template.scene;

  const updateQuality = (preference: QualityPreference) => {
    setQualityPreference(preference);
    if (preference === 'auto') localStorage.removeItem(QUALITY_STORAGE_KEY);
    else localStorage.setItem(QUALITY_STORAGE_KEY, preference);
  };

  if (contextLost) {
    return (
      <div
        className='bg-card grid aspect-video place-items-center border p-6 text-center'
        role='alert'
      >
        <div className='space-y-1'>
          <p className='font-medium'>Room rendering stopped</p>
          <p className='text-muted-foreground text-sm'>Reload this page to restore the 3D room.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={surfaceRef}
      data-room-scene-gesture-surface
      className='bg-card relative aspect-video touch-none overflow-hidden border'
      aria-label={`${template.name} interactive preview`}
    >
      <Canvas
        key={qualityTier}
        camera={{
          position: [...template.camera.landscape.position],
          fov: template.camera.landscape.fieldOfView,
        }}
        dpr={[...quality.dpr]}
        renderer={{
          antialias: quality.antialias,
          forceWebGL: false,
          powerPreference: 'high-performance',
        }}
      >
        <color attach='background' args={['#090b13']} />
        <CameraRig template={template} reducedMotion={reducedMotion} surfaceRef={surfaceRef} />
        <ContextLossGuard onLost={() => setContextLost(true)} />
        <Suspense fallback={null}>
          <Scene quality={quality} qualityTier={qualityTier} />
        </Suspense>
      </Canvas>
      <div data-room-overlay className='absolute right-3 bottom-3 flex items-center gap-2'>
        <label className='sr-only' htmlFor='room-quality'>
          Room rendering quality
        </label>
        <select
          id='room-quality'
          value={qualityPreference}
          onChange={(event) => updateQuality(event.target.value as QualityPreference)}
          className='border-border bg-background/85 text-foreground h-8 border px-2 text-xs backdrop-blur'
        >
          <option value='auto'>Auto quality</option>
          <option value='high'>High quality</option>
          <option value='medium'>Medium quality</option>
          <option value='low'>Low quality</option>
        </select>
      </div>
      <p
        data-room-overlay
        className='text-muted-foreground bg-background/70 absolute bottom-3 left-3 px-2 py-1 text-[11px]'
      >
        Drag to look around
      </p>
    </div>
  );
}

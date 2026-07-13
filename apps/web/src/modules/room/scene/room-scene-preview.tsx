import { Canvas, useFrame, useThree } from '@react-three/fiber/webgpu';
import { cn } from '@tether/ui/lib/utils';
import { Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

import { useReducedMotionPreference } from '@/hooks/use-reduced-motion-preference';

import type { RoomTemplate } from '../templates/registry';
import {
  clampLook,
  initialAdaptiveQualityState,
  isQualityPreference,
  QUALITY_CONFIGS,
  QUALITY_STORAGE_KEY,
  renderingQualitySettings,
  sampleAdaptiveQuality,
  type QualityPreference,
  resolveQualityTier,
  selectFraming,
  shouldAnimateCamera,
} from './config';
import { roomTransition, type RoomJourneyCue } from './journey';

function CameraRig({
  template,
  reducedMotion,
  surfaceRef,
  journey,
}: {
  readonly template: RoomTemplate;
  readonly reducedMotion: boolean;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly journey?: RoomJourneyCue;
}) {
  const { camera, size } = useThree();
  const look = useRef({ yaw: 0, pitch: 0 });
  const desiredLook = useRef({ yaw: 0, pitch: 0 });
  const desiredPosition = useRef(new Vector3());
  const lookEuler = useRef(new Euler(0, 0, 0, 'YXZ'));
  const lookOffset = useRef(new Quaternion());
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const lastInteraction = useRef(0);
  const previousJourney = useRef(journey);
  const previousReducedMotion = useRef(reducedMotion);
  const transition = useRef(
    roomTransition(journey ?? 'waiting', journey ?? 'waiting', reducedMotion),
  );
  const transitionRemainingSeconds = useRef(0);
  const framing =
    journey === 'outside'
      ? template.camera.outside
      : selectFraming(size.width, size.height, template.camera.landscape, template.camera.portrait);

  useEffect(() => {
    const element = surfaceRef.current;
    if (element === null) return;

    const pointerDown = (event: PointerEvent) => {
      if (reducedMotion) return;
      if ((event.target as Element).closest('[data-room-scene-ignore-gesture]') !== null) return;
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
  }, [reducedMotion, surfaceRef, template]);

  useFrame((_, delta) => {
    if (previousJourney.current !== journey || previousReducedMotion.current !== reducedMotion) {
      transition.current = roomTransition(
        previousJourney.current ?? 'waiting',
        journey ?? 'waiting',
        reducedMotion,
      );
      transitionRemainingSeconds.current = transition.current.durationMs / 1_000;
      previousJourney.current = journey;
      previousReducedMotion.current = reducedMotion;
    }

    if (performance.now() - lastInteraction.current > template.camera.look.recenterAfterMs) {
      desiredLook.current = { yaw: 0, pitch: 0 };
    }

    const animate = shouldAnimateCamera(reducedMotion);
    const transitionSeconds =
      transition.current.kind === 'enter' && transitionRemainingSeconds.current > 0
        ? transition.current.durationMs / 1_000
        : template.camera.look.recenterSeconds;
    transitionRemainingSeconds.current = Math.max(0, transitionRemainingSeconds.current - delta);
    const alpha = animate ? 1 - Math.exp((-delta * 5) / transitionSeconds) : 1;
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

function FramePerformanceMonitor({ onSample }: { readonly onSample: (fps: number) => void }) {
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

export function RoomScenePreview({
  template,
  remoteStream,
  journey,
  admissionPending = false,
  mode = 'preview',
}: {
  readonly template: RoomTemplate;
  readonly remoteStream?: MediaStream | null;
  readonly journey?: RoomJourneyCue;
  readonly admissionPending?: boolean;
  readonly mode?: 'preview' | 'call';
}) {
  const [qualityPreference, setQualityPreference] = useState(readQualityPreference);
  const [adaptiveQuality, setAdaptiveQuality] = useState(() =>
    initialAdaptiveQualityState(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1),
  );
  const [contextLost, setContextLost] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotionPreference();
  const qualityTier =
    qualityPreference === 'auto'
      ? adaptiveQuality.tier
      : resolveQualityTier(
          qualityPreference,
          typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
        );
  const quality = QUALITY_CONFIGS[qualityTier];
  const rendering = renderingQualitySettings(quality);
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
      data-room-journey={journey}
      data-room-quality-tier={qualityTier}
      data-room-admission={admissionPending ? 'pending' : 'idle'}
      data-room-remote-video={
        remoteStream === null || remoteStream === undefined ? 'absent' : 'present'
      }
      data-room-reduced-motion={reducedMotion}
      className={cn(
        'bg-card touch-none overflow-hidden',
        mode === 'call' ? 'absolute inset-0' : 'relative aspect-video border',
      )}
      aria-label={`${template.name} interactive preview`}
    >
      <Canvas
        camera={{
          position: [
            ...(journey === 'outside'
              ? template.camera.outside.position
              : template.camera.landscape.position),
          ],
          fov:
            journey === 'outside'
              ? template.camera.outside.fieldOfView
              : template.camera.landscape.fieldOfView,
        }}
        dpr={rendering.canvas.dpr}
        renderer={rendering.renderer}
      >
        <color attach='background' args={['#090b13']} />
        <CameraRig
          template={template}
          reducedMotion={reducedMotion}
          surfaceRef={surfaceRef}
          journey={journey}
        />
        {qualityPreference === 'auto' && (
          <FramePerformanceMonitor
            onSample={(fps) => setAdaptiveQuality((state) => sampleAdaptiveQuality(state, fps))}
          />
        )}
        <ContextLossGuard onLost={() => setContextLost(true)} />
        <Suspense fallback={null}>
          <Scene
            admissionPending={admissionPending}
            quality={quality}
            qualityTier={qualityTier}
            remoteStream={remoteStream}
            journey={journey}
          />
        </Suspense>
      </Canvas>
      {(mode === 'preview' || journey !== 'outside') && (
        <div
          data-room-scene-ignore-gesture
          className={cn(
            'absolute right-3 z-10 flex items-center gap-2',
            mode === 'call' ? 'top-14' : 'bottom-3',
          )}
        >
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
      )}
      {mode === 'preview' && (
        <p
          data-room-scene-ignore-gesture
          className='text-muted-foreground bg-background/70 absolute bottom-3 left-3 px-2 py-1 text-[11px]'
        >
          Drag to look around
        </p>
      )}
    </div>
  );
}

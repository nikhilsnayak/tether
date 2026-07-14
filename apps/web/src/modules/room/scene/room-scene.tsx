import { Canvas } from '@react-three/fiber/webgpu';
import type {
  AvatarPose,
  RoomSession,
  SequencedAvatarPose,
} from '@tether/client-runtime/modules/peer-session';
import { cn } from '@tether/ui/lib/utils';
import { Suspense, useRef, useState } from 'react';

import { useReducedMotionPreference } from '@/hooks/use-reduced-motion-preference';

import { AvatarControls } from '../components/avatar-controls';
import { useAvatarControls } from '../hooks/use-avatar-controls';
import type { RoomTemplate } from '../templates/registry';
import { LocalAvatarController, RemoteAvatarController } from './avatar-controllers';
import { avatarSpawn } from './avatar-motion';
import { avatarPresentation } from './avatar-presentation';
import {
  initialAdaptiveQualityState,
  isQualityPreference,
  QUALITY_CONFIGS,
  QUALITY_STORAGE_KEY,
  ROOM_RENDERER_SETTINGS,
  renderingQualitySettings,
  sampleAdaptiveQuality,
  type QualityPreference,
  resolveQualityTier,
} from './config';
import type { RoomJourneyCue } from './journey';
import { ParticipantAvatar } from './participant-avatar';
import { ContextLossGuard, FramePerformanceMonitor } from './renderer-lifecycle';
import { ThirdPersonCamera } from './third-person-camera';

const readQualityPreference = (): QualityPreference => {
  if (typeof localStorage === 'undefined') return 'auto';
  const stored = localStorage.getItem(QUALITY_STORAGE_KEY);
  return isQualityPreference(stored) ? stored : 'auto';
};

export function RoomScene({
  template,
  journey,
  admissionPending = false,
  mode = 'preview',
  sessionIntent = 'host',
  remoteAvatarPose = null,
  roomEventsReady = false,
  sendAvatarPose = () => false,
}: {
  readonly template: RoomTemplate;
  readonly journey?: RoomJourneyCue;
  readonly admissionPending?: boolean;
  readonly mode?: 'preview' | 'call';
  readonly sessionIntent?: RoomSession['intent'];
  readonly remoteAvatarPose?: SequencedAvatarPose | null;
  readonly roomEventsReady?: boolean;
  readonly sendAvatarPose?: (pose: AvatarPose) => boolean;
}) {
  const [qualityPreference, setQualityPreference] = useState(readQualityPreference);
  const [adaptiveQuality, setAdaptiveQuality] = useState(() =>
    initialAdaptiveQualityState(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1),
  );
  const [contextLost, setContextLost] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const localPoseRef = useRef<AvatarPose>(avatarSpawn(template.gameplay, sessionIntent));
  const remoteIntent: RoomSession['intent'] = sessionIntent === 'host' ? 'join' : 'host';
  const remotePoseRef = useRef<AvatarPose>(avatarSpawn(template.gameplay, remoteIntent));
  const reducedMotion = useReducedMotionPreference();
  const activeJourney = journey ?? 'waiting';
  const presentation = avatarPresentation(sessionIntent, activeJourney);
  const controlsEnabled =
    mode === 'call' &&
    presentation.localLocation === 'inside' &&
    activeJourney !== 'ended' &&
    activeJourney !== 'departed';
  const { input, recenter, recenterSignal, setControlHeld } = useAvatarControls(
    controlsEnabled,
    mode === 'call',
  );
  const qualityTier =
    qualityPreference === 'auto'
      ? adaptiveQuality.tier
      : resolveQualityTier(
          qualityPreference,
          typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
        );
  const quality = QUALITY_CONFIGS[qualityTier];
  const rendering = renderingQualitySettings(quality);
  const SceneEnvironment = template.scene;

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
      data-room-location={presentation.localLocation}
      data-room-quality-tier={qualityTier}
      data-room-admission={admissionPending ? 'pending' : 'idle'}
      data-room-reduced-motion={reducedMotion}
      data-room-local-avatar={mode === 'call' ? presentation.local : 'absent'}
      data-room-remote-avatar={mode === 'call' ? presentation.remote : 'absent'}
      data-room-avatar-sync={roomEventsReady ? 'ready' : 'unavailable'}
      data-room-display='idle'
      className={cn(
        'bg-card touch-none overflow-hidden',
        mode === 'call' ? 'absolute inset-0' : 'relative aspect-video border',
      )}
      aria-label={`${template.name} room scene`}
    >
      <Canvas
        camera={{
          position: [...template.camera.landscape.position],
          fov: template.camera.landscape.fieldOfView,
        }}
        dpr={rendering.canvas.dpr}
        shadows={rendering.canvas.shadows}
        renderer={ROOM_RENDERER_SETTINGS}
      >
        <color attach='background' args={['#090b13']} />
        <ThirdPersonCamera
          template={template}
          poseRef={localPoseRef}
          reducedMotion={reducedMotion}
          surfaceRef={surfaceRef}
          journey={journey}
          mode={mode}
          recenterSignal={recenterSignal}
        />
        {mode === 'call' && (
          <>
            <LocalAvatarController
              poseRef={localPoseRef}
              input={input}
              gameplay={template.gameplay}
              intent={sessionIntent}
              location={presentation.localLocation}
              enabled={controlsEnabled}
              sendAvatarPose={sendAvatarPose}
              surfaceRef={surfaceRef}
            />
            <RemoteAvatarController
              poseRef={remotePoseRef}
              incoming={remoteAvatarPose}
              ready={roomEventsReady}
              presence={presentation.remote}
              gameplay={template.gameplay}
              remoteIntent={remoteIntent}
              reducedMotion={reducedMotion}
              surfaceRef={surfaceRef}
            />
            <ParticipantAvatar
              poseRef={localPoseRef}
              participant='local'
              reducedMotion={reducedMotion}
            />
            {presentation.remote !== 'absent' && (
              <ParticipantAvatar
                poseRef={remotePoseRef}
                participant='remote'
                reducedMotion={reducedMotion}
                reconnecting={presentation.remote === 'reconnecting'}
              />
            )}
          </>
        )}
        <FramePerformanceMonitor
          onSample={(fps) => {
            if (surfaceRef.current !== null) surfaceRef.current.dataset.roomFps = fps.toFixed(1);
            if (qualityPreference === 'auto') {
              setAdaptiveQuality((state) => sampleAdaptiveQuality(state, fps));
            }
          }}
        />
        <ContextLossGuard updateContextLost={setContextLost} />
        <Suspense fallback={null}>
          <SceneEnvironment
            admissionPending={admissionPending}
            quality={quality}
            qualityTier={qualityTier}
            reducedMotion={reducedMotion}
            journey={journey}
          />
        </Suspense>
      </Canvas>
      {mode === 'call' && presentation.localLocation === 'inside' && (
        <AvatarControls
          disabled={!controlsEnabled}
          onHeldChange={setControlHeld}
          onRecenter={recenter}
        />
      )}
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
      {mode === 'call' && presentation.localLocation === 'inside' && (
        <p
          data-room-scene-ignore-gesture
          className='bg-background/70 text-muted-foreground absolute bottom-24 left-28 z-10 hidden px-2 py-1 text-[10px] sm:block'
        >
          WASD / arrows to move · R to recenter · drag to orbit · scroll to zoom
        </p>
      )}
    </div>
  );
}

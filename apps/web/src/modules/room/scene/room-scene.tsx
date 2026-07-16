import { Canvas } from '@react-three/fiber/webgpu';
import type {
  AvatarPose,
  RoomSession,
  SequencedAvatarPose,
} from '@tether/client-runtime/modules/peer-session';
import { Suspense, useRef, useState } from 'react';

import { useReducedMotionPreference } from '@/hooks/use-reduced-motion-preference';

import { AvatarControls } from '../components/avatar-controls';
import { RoomControlHelp } from '../components/room-control-help';
import { useAvatarControls } from '../hooks/use-avatar-controls';
import { useRoomQualityPreference } from '../hooks/use-room-quality-preference';
import type { RoomTemplate } from '../templates/registry';
import { LocalAvatarController, RemoteAvatarController } from './avatar-controllers';
import { avatarSpawn } from './avatar-motion';
import { avatarPresentation } from './avatar-presentation';
import {
  initialAdaptiveQualityState,
  QUALITY_CONFIGS,
  ROOM_RENDERER_SETTINGS,
  renderingQualitySettings,
  sampleAdaptiveQuality,
  selectCameraFraming,
  resolveQualityTier,
} from './config';
import type { RoomJourneyCue } from './journey';
import { ParticipantAvatar } from './participant-avatar';
import {
  ContextLossGuard,
  FramePerformanceMonitor,
  RendererStatusObserver,
} from './renderer-lifecycle';
import { RoomTransitionController } from './room-transition-controller';
import { ThirdPersonCamera } from './third-person-camera';

export function RoomScene({
  template,
  journey,
  admissionPending,
  sessionIntent,
  remoteAvatarPose,
  roomEventsReady,
  sendAvatarPose,
}: {
  readonly template: RoomTemplate;
  readonly journey: RoomJourneyCue;
  readonly admissionPending: boolean;
  readonly sessionIntent: RoomSession['intent'];
  readonly remoteAvatarPose: SequencedAvatarPose | null;
  readonly roomEventsReady: boolean;
  readonly sendAvatarPose: (pose: AvatarPose) => boolean;
}) {
  const { qualityPreference } = useRoomQualityPreference();
  const deviceDpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const [adaptiveQuality, setAdaptiveQuality] = useState(() =>
    initialAdaptiveQualityState(deviceDpr),
  );
  const [contextLost, setContextLost] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const localPoseRef = useRef<AvatarPose>(avatarSpawn(template.gameplay, sessionIntent));
  const remoteIntent: RoomSession['intent'] = sessionIntent === 'host' ? 'join' : 'host';
  const remotePoseRef = useRef<AvatarPose>(avatarSpawn(template.gameplay, remoteIntent));
  const reducedMotion = useReducedMotionPreference();
  const activeJourney = journey ?? 'waiting';
  const [spatialJourney, setSpatialJourney] = useState(activeJourney);
  const presentation = avatarPresentation(sessionIntent, spatialJourney);
  const cameraOutside = presentation.localLocation === 'outside';
  const controlsEnabled =
    presentation.localLocation === 'inside' &&
    activeJourney !== 'ended' &&
    activeJourney !== 'departed';
  const { input, recenter, recenterSignal, setControlHeld } = useAvatarControls(controlsEnabled);
  const qualityTier =
    qualityPreference === 'auto'
      ? adaptiveQuality.tier
      : resolveQualityTier(qualityPreference, deviceDpr);
  const quality = QUALITY_CONFIGS[qualityTier];
  const rendering = renderingQualitySettings(quality);
  const SceneEnvironment = template.scene;

  if (contextLost) {
    return (
      <div
        className='bg-card absolute inset-0 grid place-items-center p-6 text-center'
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
      data-room-local-avatar={presentation.local}
      data-room-remote-avatar={presentation.remote}
      data-room-avatar-sync={roomEventsReady ? 'ready' : 'unavailable'}
      data-room-display='idle'
      // isolate traps the drei Html labels' large z-index inside the scene so
      // they cannot paint over the sibling entry/call overlays.
      className='bg-card absolute inset-0 isolate touch-none overflow-hidden'
      aria-label={`${template.name} room scene`}
    >
      <Canvas
        camera={{
          position: [...template.camera.landscape.position],
          fov: template.camera.landscape.fieldOfView,
        }}
        dpr={rendering.canvas.dpr}
        onCreated={({ camera, size }) => {
          const framing = selectCameraFraming(
            size.width,
            size.height,
            cameraOutside,
            template.camera,
          );
          camera.position.set(...framing.position);
          if ('fov' in camera) camera.fov = framing.fieldOfView;
          camera.updateProjectionMatrix();
        }}
        shadows={rendering.canvas.shadows}
        renderer={ROOM_RENDERER_SETTINGS}
      >
        <color attach='background' args={['#090b13']} />
        <RoomTransitionController
          journey={activeJourney}
          reducedMotion={reducedMotion}
          updateSpatialJourney={setSpatialJourney}
        />
        <ThirdPersonCamera
          template={template}
          poseRef={localPoseRef}
          reducedMotion={reducedMotion}
          surfaceRef={surfaceRef}
          outside={cameraOutside}
          recenterSignal={recenterSignal}
        />
        <LocalAvatarController
          poseRef={localPoseRef}
          input={input}
          gameplay={template.gameplay}
          intent={sessionIntent}
          location={presentation.localLocation}
          enabled={controlsEnabled}
          sendAvatarPose={sendAvatarPose}
          surfaceRef={surfaceRef}
          blockerRef={remotePoseRef}
          blockerActive={presentation.remote !== 'absent'}
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
          <RendererStatusObserver surfaceRef={surfaceRef} />
        </Suspense>
      </Canvas>
      {presentation.localLocation === 'inside' && (
        <AvatarControls
          disabled={!controlsEnabled}
          onHeldChange={setControlHeld}
          onRecenter={recenter}
        />
      )}
      {presentation.localLocation === 'inside' && <RoomControlHelp />}
    </div>
  );
}

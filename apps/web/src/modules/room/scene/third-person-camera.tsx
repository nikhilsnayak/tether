import { useFrame, useThree } from '@react-three/fiber/webgpu';
import type { AvatarPose } from '@tether/client-runtime/modules/peer-session';
import { useEffect, useRef, type RefObject } from 'react';
import { MathUtils, Vector3 } from 'three';

import type { RoomTemplate } from '../templates/registry';
import { cameraContainmentScale } from './camera-containment';
import { clampLook, selectCameraFraming } from './config';

const WORLD_UP = new Vector3(0, 1, 0);
const CAMERA_VERTICAL_BOUNDS = { minY: 0.8, maxY: 4.2 } as const;
const CAMERA_AVATAR_CLEARANCE = 1;

export function ThirdPersonCamera({
  template,
  poseRef,
  reducedMotion,
  surfaceRef,
  outside,
  recenterSignal,
  cameraYawRef,
}: {
  readonly template: RoomTemplate;
  readonly poseRef: RefObject<AvatarPose>;
  readonly reducedMotion: boolean;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly outside: boolean;
  readonly recenterSignal: RefObject<number>;
  readonly cameraYawRef: RefObject<number>;
}) {
  const { camera, size } = useThree();
  const orbit = useRef({ yaw: poseRef.current.yaw, pitch: 0 });
  const outsideLook = useRef({ yaw: 0, pitch: 0 });
  const distance = useRef(template.gameplay.camera.distance);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const touchPointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef<number | null>(null);
  const followed = useRef(new Vector3(poseRef.current.x, 0, poseRef.current.z));
  const desiredPosition = useRef(new Vector3());
  const desiredFollow = useRef(new Vector3());
  const cameraOrigin = useRef(new Vector3());
  const avatarOrigin = useRef(new Vector3());
  const cameraOffset = useRef(new Vector3());
  const target = useRef(new Vector3());
  const lookDirection = useRef(new Vector3());
  const lookRight = useRef(new Vector3());
  const previousRecenterSignal = useRef(recenterSignal.current);
  const wasOutside = useRef(outside);
  const lastDiagnosticAtMs = useRef(0);

  useEffect(() => {
    const element = surfaceRef.current;
    if (element === null) return;
    const pointerDown = (event: PointerEvent) => {
      if ((event.target as Element).closest('[data-room-scene-ignore-gesture]') !== null) return;
      if (event.pointerType === 'touch') {
        touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPointers.current.size === 2) {
          const [first, second] = [...touchPointers.current.values()];
          if (first !== undefined && second !== undefined) {
            pinchDistance.current = Math.hypot(first.x - second.x, first.y - second.y);
          }
          drag.current = null;
        }
      }
      if (touchPointers.current.size < 2) {
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      }
      element.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && touchPointers.current.has(event.pointerId)) {
        touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPointers.current.size >= 2) {
          const [first, second] = [...touchPointers.current.values()];
          if (first !== undefined && second !== undefined) {
            const nextDistance = Math.hypot(first.x - second.x, first.y - second.y);
            if (pinchDistance.current !== null) {
              distance.current = MathUtils.clamp(
                distance.current - (nextDistance - pinchDistance.current) * 0.012,
                template.gameplay.camera.minimumDistance,
                template.gameplay.camera.maximumDistance,
              );
            }
            pinchDistance.current = nextDistance;
          }
          return;
        }
      }
      const current = drag.current;
      if (current === null || current.pointerId !== event.pointerId) return;
      const look = outside ? outsideLook : orbit;
      look.current = {
        yaw: look.current.yaw - (event.clientX - current.x) * 0.004,
        pitch: MathUtils.clamp(
          look.current.pitch - (event.clientY - current.y) * 0.003,
          -0.35,
          0.45,
        ),
      };
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      touchPointers.current.delete(event.pointerId);
      if (touchPointers.current.size < 2) pinchDistance.current = null;
      if (drag.current?.pointerId === event.pointerId) drag.current = null;
      if (event.pointerType === 'touch' && touchPointers.current.size === 1) {
        const remaining = touchPointers.current.entries().next().value;
        if (remaining !== undefined) {
          const [pointerId, position] = remaining;
          drag.current = { pointerId, ...position };
        }
      }
    };
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('[data-room-scene-ignore-gesture]') !== null) return;
      event.preventDefault();
      distance.current = MathUtils.clamp(
        distance.current + event.deltaY * 0.006,
        template.gameplay.camera.minimumDistance,
        template.gameplay.camera.maximumDistance,
      );
    };
    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('pointermove', pointerMove);
    element.addEventListener('pointerup', pointerUp);
    element.addEventListener('pointercancel', pointerUp);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('pointermove', pointerMove);
      element.removeEventListener('pointerup', pointerUp);
      element.removeEventListener('pointercancel', pointerUp);
      element.removeEventListener('wheel', wheel);
    };
  }, [outside, surfaceRef, template]);

  const updateOutsideCamera = (delta: number, framing: ReturnType<typeof selectCameraFraming>) => {
    // Outside the room the guest may only glance around within tight bounds so
    // they cannot rotate the view to peek inside before being admitted.
    outsideLook.current = clampLook(
      outsideLook.current.yaw,
      outsideLook.current.pitch,
      template.camera.look,
    );
    desiredPosition.current.set(...framing.position);
    camera.position.lerp(desiredPosition.current, reducedMotion ? 1 : 1 - Math.exp(-delta * 6));
    lookDirection.current
      .set(...framing.target)
      .sub(desiredPosition.current)
      .normalize()
      .applyAxisAngle(WORLD_UP, outsideLook.current.yaw);
    lookRight.current.crossVectors(lookDirection.current, WORLD_UP).normalize();
    lookDirection.current.applyAxisAngle(lookRight.current, outsideLook.current.pitch);
    target.current.copy(desiredPosition.current).add(lookDirection.current);
    camera.lookAt(target.current);
  };

  const updateInsideCamera = (delta: number) => {
    if (wasOutside.current) orbit.current = { yaw: poseRef.current.yaw, pitch: 0 };
    cameraYawRef.current = orbit.current.yaw;
    const followAlpha = reducedMotion
      ? 1
      : 1 - Math.exp(-delta / template.gameplay.camera.followSeconds);
    desiredFollow.current.set(poseRef.current.x, 0, poseRef.current.z);
    followed.current.lerp(desiredFollow.current, followAlpha);
    const yaw = orbit.current.yaw;
    const horizontalDistance = distance.current * Math.cos(orbit.current.pitch);
    desiredPosition.current.set(
      followed.current.x - Math.sin(yaw) * horizontalDistance,
      template.gameplay.camera.height + Math.sin(orbit.current.pitch) * distance.current,
      followed.current.z - Math.cos(yaw) * horizontalDistance,
    );
    cameraOrigin.current.set(
      followed.current.x,
      template.gameplay.camera.targetHeight,
      followed.current.z,
    );
    const containmentScale = cameraContainmentScale(
      cameraOrigin.current,
      desiredPosition.current,
      template.gameplay.walkableBounds,
      CAMERA_VERTICAL_BOUNDS,
    );
    desiredPosition.current
      .sub(cameraOrigin.current)
      .multiplyScalar(containmentScale)
      .add(cameraOrigin.current);
    camera.position.lerp(desiredPosition.current, followAlpha);
    avatarOrigin.current.set(
      poseRef.current.x,
      template.gameplay.camera.targetHeight,
      poseRef.current.z,
    );
    cameraOffset.current.copy(camera.position).sub(avatarOrigin.current);
    if (cameraOffset.current.lengthSq() < CAMERA_AVATAR_CLEARANCE ** 2) {
      if (cameraOffset.current.lengthSq() < 0.000_001) {
        cameraOffset.current.copy(desiredPosition.current).sub(avatarOrigin.current);
      }
      cameraOffset.current.setLength(CAMERA_AVATAR_CLEARANCE);
      desiredPosition.current.copy(avatarOrigin.current).add(cameraOffset.current);
      const clearanceContainmentScale = cameraContainmentScale(
        avatarOrigin.current,
        desiredPosition.current,
        template.gameplay.walkableBounds,
        CAMERA_VERTICAL_BOUNDS,
      );
      camera.position
        .copy(cameraOffset.current)
        .multiplyScalar(clearanceContainmentScale)
        .add(avatarOrigin.current);
    }
    target.current.copy(cameraOrigin.current);
    camera.lookAt(target.current);
    const nowMs = performance.now();
    if (nowMs - lastDiagnosticAtMs.current >= 100 && surfaceRef.current !== null) {
      surfaceRef.current.dataset.roomCameraDistance = camera.position
        .distanceTo(avatarOrigin.current)
        .toFixed(3);
      lastDiagnosticAtMs.current = nowMs;
    }
  };

  const updateFieldOfView = (fieldOfView: number) => {
    if ('fov' in camera) {
      if (camera.fov !== fieldOfView) {
        camera.fov = fieldOfView;
        camera.updateProjectionMatrix();
      }
    }
  };

  useFrame((_, delta) => {
    if (previousRecenterSignal.current !== recenterSignal.current) {
      orbit.current = { yaw: poseRef.current.yaw, pitch: 0 };
      distance.current = template.gameplay.camera.distance;
      previousRecenterSignal.current = recenterSignal.current;
    }

    const framing = selectCameraFraming(size.width, size.height, outside, template.camera);
    if (outside) updateOutsideCamera(delta, framing);
    else updateInsideCamera(delta);
    wasOutside.current = outside;
    updateFieldOfView(framing.fieldOfView);
  });

  return null;
}

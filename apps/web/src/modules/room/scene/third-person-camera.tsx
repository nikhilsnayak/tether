import { useFrame, useThree } from '@react-three/fiber/webgpu';
import type { AvatarPose } from '@tether/client-runtime/modules/peer-session';
import { useEffect, useRef, type RefObject } from 'react';
import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';

import type { RoomTemplate } from '../templates/registry';
import { cameraContainmentScale, resolveCameraClearance } from './camera-containment';
import { clampLook, selectCameraFraming, selectResponsiveCameraFraming } from './config';

const WORLD_UP = new Vector3(0, 1, 0);
const CAMERA_VERTICAL_BOUNDS = { minY: 0.8, maxY: 4.2 } as const;
const CAMERA_AVATAR_CLEARANCE = 1;
const WATCH_CAMERA_DAMPING = 4;

export function ThirdPersonCamera({
  template,
  poseRef,
  reducedMotion,
  surfaceRef,
  outside,
  recenterSignal,
  cameraYawRef,
  watchFraming,
}: {
  readonly template: RoomTemplate;
  readonly poseRef: RefObject<AvatarPose>;
  readonly reducedMotion: boolean;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly outside: boolean;
  readonly recenterSignal: RefObject<number>;
  readonly cameraYawRef: RefObject<number>;
  readonly watchFraming: boolean;
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
  const lookMatrix = useRef(new Matrix4());
  const desiredRotation = useRef(new Quaternion());
  const previousRecenterSignal = useRef(recenterSignal.current);
  const wasOutside = useRef(outside);
  const previousWatchFraming = useRef(watchFraming);
  const watchFramingSuppressed = useRef(false);
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
              if (Math.abs(nextDistance - pinchDistance.current) >= 1) {
                watchFramingSuppressed.current = watchFraming;
              }
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
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 1) {
        watchFramingSuppressed.current = watchFraming;
      }
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
      watchFramingSuppressed.current = watchFraming;
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
  }, [outside, surfaceRef, template, watchFraming]);

  const lookAt = (point: Vector3, alpha: number) => {
    lookMatrix.current.lookAt(camera.position, point, camera.up);
    desiredRotation.current.setFromRotationMatrix(lookMatrix.current);
    camera.quaternion.slerp(desiredRotation.current, alpha);
  };

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
    avatarOrigin.current.set(
      poseRef.current.x,
      template.gameplay.camera.targetHeight,
      poseRef.current.z,
    );
    cameraOffset.current.copy(desiredPosition.current).sub(avatarOrigin.current);
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
    const targetDistanceSq = desiredPosition.current.distanceToSquared(avatarOrigin.current);
    if (targetDistanceSq < CAMERA_AVATAR_CLEARANCE ** 2) {
      if (targetDistanceSq >= 1e-6) {
        cameraOffset.current.copy(desiredPosition.current).sub(avatarOrigin.current);
      }
      desiredPosition.current.copy(avatarOrigin.current).add(cameraOffset.current);
      const clearancePosition = resolveCameraClearance(
        avatarOrigin.current,
        desiredPosition.current,
        CAMERA_AVATAR_CLEARANCE,
        template.gameplay.walkableBounds,
        CAMERA_VERTICAL_BOUNDS,
      );
      desiredPosition.current.set(clearancePosition.x, clearancePosition.y, clearancePosition.z);
    }
    camera.position.lerp(desiredPosition.current, followAlpha);
    target.current.copy(cameraOrigin.current);
    lookAt(target.current, followAlpha);
    const nowMs = performance.now();
    if (nowMs - lastDiagnosticAtMs.current >= 100 && surfaceRef.current !== null) {
      surfaceRef.current.dataset.roomCameraDistance = camera.position
        .distanceTo(avatarOrigin.current)
        .toFixed(3);
      lastDiagnosticAtMs.current = nowMs;
    }
  };

  const updateWatchCamera = (
    delta: number,
    framing: ReturnType<typeof selectResponsiveCameraFraming>,
  ) => {
    const alpha = reducedMotion ? 1 : 1 - Math.exp(-delta * WATCH_CAMERA_DAMPING);
    desiredPosition.current.set(...framing.position);
    camera.position.lerp(desiredPosition.current, alpha);
    target.current.set(...framing.target);
    lookAt(target.current, alpha);
    cameraYawRef.current = 0;
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
    if (previousWatchFraming.current !== watchFraming) {
      watchFramingSuppressed.current = false;
      previousWatchFraming.current = watchFraming;
    }
    if (previousRecenterSignal.current !== recenterSignal.current) {
      orbit.current = { yaw: poseRef.current.yaw, pitch: 0 };
      distance.current = template.gameplay.camera.distance;
      watchFramingSuppressed.current = false;
      previousRecenterSignal.current = recenterSignal.current;
    }

    const framing = selectCameraFraming(size.width, size.height, outside, template.camera);
    const watchCamera = template.watchAlong?.camera;
    const watchCameraEngaged =
      !outside && watchFraming && !watchFramingSuppressed.current && watchCamera !== undefined;
    let fieldOfView = framing.fieldOfView;
    if (outside) {
      updateOutsideCamera(delta, framing);
    } else if (watchCameraEngaged && watchCamera !== undefined) {
      const watchCameraFraming = selectResponsiveCameraFraming(
        size.width,
        size.height,
        watchCamera,
      );
      updateWatchCamera(delta, watchCameraFraming);
      fieldOfView = watchCameraFraming.fieldOfView;
    } else {
      updateInsideCamera(delta);
    }
    if (surfaceRef.current !== null) {
      surfaceRef.current.dataset.roomCameraMode = watchCameraEngaged ? 'watch' : 'avatar';
    }
    wasOutside.current = outside;
    updateFieldOfView(fieldOfView);
  });

  return null;
}

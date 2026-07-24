import { useFrame } from '@react-three/fiber/webgpu';
import type { AvatarPose } from '@tether/client-runtime/modules/peer-session';
import type { RefObject } from 'react';

import { listenerForwardFromYaw } from '../audio/spatial-audio';
import { useSpatialAudio } from '../components/spatial-audio-context';

export function SpatialAudioWriter({
  localPoseRef,
  remotePoseRef,
  cameraYawRef,
  remotePresent,
}: {
  readonly localPoseRef: RefObject<AvatarPose>;
  readonly remotePoseRef: RefObject<AvatarPose>;
  readonly cameraYawRef: RefObject<number>;
  readonly remotePresent: boolean;
}) {
  const { stateRef } = useSpatialAudio();

  useFrame(() => {
    const state = stateRef.current;
    const local = localPoseRef.current;
    const remote = remotePoseRef.current;
    state.listener.position.x = local.x;
    state.listener.position.z = local.z;
    const forward = listenerForwardFromYaw(cameraYawRef.current);
    state.listener.orientation.forwardX = forward.forwardX;
    state.listener.orientation.forwardZ = forward.forwardZ;
    state.remote.position.x = remote.x;
    state.remote.position.z = remote.z;
    state.remote.present = remotePresent;
  });

  return null;
}

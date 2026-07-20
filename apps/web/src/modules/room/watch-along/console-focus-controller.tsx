import { useFrame } from '@react-three/fiber/webgpu';
import type { AvatarPose } from '@tether/client-runtime/modules/peer-session';
import type { RefObject } from 'react';

import type { RoomTemplate } from '../templates/registry';
import { canEnterConsoleFocus } from './console-focus';
import { useConsoleFocus } from './console-focus-context';

export function ConsoleFocusController({
  poseRef,
  capability,
}: {
  readonly poseRef: RefObject<AvatarPose>;
  readonly capability: NonNullable<RoomTemplate['watchAlong']>;
}) {
  const consoleFocus = useConsoleFocus();
  useFrame(() => {
    const inRange = canEnterConsoleFocus(poseRef.current, capability.console);
    if (inRange !== consoleFocus.inRange) {
      consoleFocus.dispatch({ _tag: 'RangeChanged', inRange });
    }
  });
  return null;
}

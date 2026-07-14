import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber/webgpu';
import type { AvatarPose } from '@tether/client-runtime/modules/peer-session';
import { useRef, type RefObject } from 'react';
import type { Group } from 'three';

export function ParticipantAvatar({
  poseRef,
  participant,
  reducedMotion,
  reconnecting = false,
}: {
  readonly poseRef: RefObject<AvatarPose>;
  readonly participant: 'local' | 'remote';
  readonly reducedMotion: boolean;
  readonly reconnecting?: boolean;
}) {
  const group = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);

  useFrame(() => {
    const pose = poseRef.current;
    const avatar = group.current;
    if (avatar === null) return;
    avatar.position.set(pose.x, 0, pose.z);
    avatar.rotation.y = pose.yaw;
    const stride =
      !reducedMotion && pose.action === 'walk'
        ? Math.sin((performance.now() / 1_000) * 10) * 0.5
        : 0;
    if (leftLeg.current !== null) leftLeg.current.rotation.x = stride;
    if (rightLeg.current !== null) rightLeg.current.rotation.x = -stride;
  });

  const local = participant === 'local';
  const bodyColor = local ? '#e88952' : '#668ce8';
  const accentColor = local ? '#ffd2b5' : '#c7d5ff';

  return (
    <group ref={group}>
      <mesh position={[0, 1.18, 0]} castShadow>
        <capsuleGeometry args={[0.28, 0.72, 6, 12]} />
        <meshStandardMaterial color={bodyColor} roughness={0.72} />
      </mesh>
      <mesh position={[0, 1.86, 0]} castShadow>
        <sphereGeometry args={[0.28, 16, 12]} />
        <meshStandardMaterial color={accentColor} roughness={0.78} />
      </mesh>
      <mesh position={[-0.09, 1.9, 0.255]}>
        <sphereGeometry args={[0.025, 8, 6]} />
        <meshBasicMaterial color='#161923' />
      </mesh>
      <mesh position={[0.09, 1.9, 0.255]}>
        <sphereGeometry args={[0.025, 8, 6]} />
        <meshBasicMaterial color='#161923' />
      </mesh>
      <group ref={leftLeg} position={[-0.14, 0.72, 0]}>
        <mesh position={[0, -0.34, 0]} castShadow>
          <capsuleGeometry args={[0.1, 0.48, 5, 8]} />
          <meshStandardMaterial color='#202431' roughness={0.85} />
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.14, 0.72, 0]}>
        <mesh position={[0, -0.34, 0]} castShadow>
          <capsuleGeometry args={[0.1, 0.48, 5, 8]} />
          <meshStandardMaterial color='#202431' roughness={0.85} />
        </mesh>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <circleGeometry args={[0.36, 20]} />
        <meshBasicMaterial color='#000000' transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <Html center position={[0, 2.35, 0]} distanceFactor={7}>
        <span className='border-border/70 bg-background/80 text-foreground pointer-events-none rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wider whitespace-nowrap uppercase shadow'>
          {local ? 'You' : reconnecting ? 'Other person · reconnecting' : 'Other person'}
        </span>
      </Html>
    </group>
  );
}

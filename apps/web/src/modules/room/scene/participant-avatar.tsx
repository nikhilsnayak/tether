import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber/webgpu';
import type { AvatarPose } from '@tether/client-runtime/modules/peer-session';
import { useRef, type RefObject } from 'react';
import { CatmullRomCurve3, Vector3, type Group } from 'three';

const palette = {
  local: { body: '#f6ecdc', limb: '#eee1cd', accent: '#f39a55' },
  remote: { body: '#e4edf9', limb: '#d9e5f5', accent: '#718fe8' },
} as const;

const faceColor = '#111319';

const headFacePoint = (x: number, y: number) => {
  const radiusX = 0.46;
  const radiusY = 0.57;
  const radiusZ = 0.45;
  const normalizedDepth = Math.max(0, 1 - (x / radiusX) ** 2 - (y / radiusY) ** 2);
  return new Vector3(x, 1.78 + y, radiusZ * Math.sqrt(normalizedDepth) + 0.008);
};

const faceCurve = (points: readonly (readonly [number, number])[], closed = false) =>
  new CatmullRomCurve3(
    points.map(([x, y]) => headFacePoint(x, y)),
    closed,
    'centripetal',
  );

const leftEye = faceCurve([
  [-0.235, 0.1],
  [-0.205, 0.145],
  [-0.16, 0.16],
  [-0.115, 0.145],
  [-0.085, 0.1],
]);

const rightEye = faceCurve([
  [0.085, 0.1],
  [0.115, 0.145],
  [0.16, 0.16],
  [0.205, 0.145],
  [0.235, 0.1],
]);

const smileOutline = faceCurve(
  [
    [-0.3, -0.06],
    [-0.22, -0.025],
    [-0.11, -0.015],
    [0, -0.01],
    [0.11, -0.015],
    [0.22, -0.025],
    [0.3, -0.06],
    [0.285, -0.19],
    [0.22, -0.31],
    [0.11, -0.375],
    [0, -0.395],
    [-0.11, -0.375],
    [-0.22, -0.31],
    [-0.285, -0.19],
  ],
  true,
);

const toothDividers = [
  {
    key: 'left-outer',
    curve: faceCurve([
      [-0.17, -0.03],
      [-0.17, -0.13],
      [-0.15, -0.25],
      [-0.12, -0.36],
    ]),
  },
  {
    key: 'left-inner',
    curve: faceCurve([
      [-0.06, -0.015],
      [-0.06, -0.13],
      [-0.05, -0.27],
      [-0.04, -0.39],
    ]),
  },
  {
    key: 'right-inner',
    curve: faceCurve([
      [0.06, -0.015],
      [0.06, -0.13],
      [0.05, -0.27],
      [0.04, -0.39],
    ]),
  },
  {
    key: 'right-outer',
    curve: faceCurve([
      [0.17, -0.03],
      [0.17, -0.13],
      [0.15, -0.25],
      [0.12, -0.36],
    ]),
  },
] as const;

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
  const visual = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);

  useFrame(() => {
    const pose = poseRef.current;
    const avatar = group.current;
    if (avatar === null) return;
    avatar.position.set(pose.x, 0, pose.z);
    avatar.rotation.y = pose.yaw;

    const walking = !reducedMotion && pose.action === 'walk';
    const phase = walking ? Math.sin((performance.now() / 1_000) * 9) : 0;
    if (leftLeg.current !== null) leftLeg.current.rotation.x = phase * 0.6;
    if (rightLeg.current !== null) rightLeg.current.rotation.x = -phase * 0.6;
    if (leftArm.current !== null) leftArm.current.rotation.x = -0.3 - phase * 0.45;
    if (rightArm.current !== null) rightArm.current.rotation.x = -0.3 + phase * 0.45;
    if (visual.current !== null) visual.current.position.y = walking ? Math.abs(phase) * 0.03 : 0;
  });

  const colors = participant === 'local' ? palette.local : palette.remote;
  const bodyMaterial = (
    <meshStandardMaterial
      color={colors.body}
      emissive={colors.body}
      emissiveIntensity={0.14}
      roughness={0.66}
      metalness={0.02}
    />
  );
  const limbMaterial = <meshStandardMaterial color={colors.limb} roughness={0.72} />;

  return (
    <group ref={group}>
      <group scale={0.78}>
        <group ref={visual}>
          {/* Soft, top-heavy silhouette assembled from matching porcelain-like forms. */}
          <mesh position={[0, 0.78, 0]} scale={[0.8, 1.2, 0.76]} castShadow>
            <sphereGeometry args={[0.42, 24, 20]} />
            {bodyMaterial}
          </mesh>
          <mesh position={[0, 1.28, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.13, 0.16, 18]} />
            {bodyMaterial}
          </mesh>
          <mesh position={[0, 1.3, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.135, 0.024, 8, 24]} />
            <meshStandardMaterial
              color={colors.accent}
              emissive={colors.accent}
              emissiveIntensity={0.22}
              roughness={0.58}
            />
          </mesh>
          <mesh position={[0, 1.78, 0]} scale={[0.92, 1.14, 0.9]} castShadow>
            <sphereGeometry args={[0.5, 32, 24]} />
            {bodyMaterial}
          </mesh>

          {/* Ellipsoid-projected curves hug the head instead of floating in front of it. */}
          <mesh>
            <tubeGeometry args={[leftEye, 16, 0.014, 8, false]} />
            <meshBasicMaterial color={faceColor} />
          </mesh>
          <mesh>
            <tubeGeometry args={[rightEye, 16, 0.014, 8, false]} />
            <meshBasicMaterial color={faceColor} />
          </mesh>

          {/* Exposed head material reads as the teeth inside the outlined grin. */}
          <mesh>
            <tubeGeometry args={[smileOutline, 64, 0.018, 8, true]} />
            <meshBasicMaterial color={faceColor} />
          </mesh>
          {toothDividers.map(({ key, curve }) => (
            <mesh key={key}>
              <tubeGeometry args={[curve, 20, 0.008, 8, false]} />
              <meshBasicMaterial color={faceColor} />
            </mesh>
          ))}

          {/* Slender limbs and oversized round hands and feet. */}
          <group ref={leftArm} position={[-0.3, 1, 0.03]} rotation={[0, 0, 0.08]}>
            <mesh position={[0, -0.22, 0]} castShadow>
              <capsuleGeometry args={[0.05, 0.38, 5, 10]} />
              {limbMaterial}
            </mesh>
            <mesh position={[0, -0.46, 0]} castShadow>
              <sphereGeometry args={[0.078, 14, 10]} />
              {limbMaterial}
            </mesh>
          </group>
          <group ref={rightArm} position={[0.3, 1, 0.03]} rotation={[0, 0, -0.08]}>
            <mesh position={[0, -0.22, 0]} castShadow>
              <capsuleGeometry args={[0.05, 0.38, 5, 10]} />
              {limbMaterial}
            </mesh>
            <mesh position={[0, -0.46, 0]} castShadow>
              <sphereGeometry args={[0.078, 14, 10]} />
              {limbMaterial}
            </mesh>
          </group>

          <group ref={leftLeg} position={[-0.14, 0.46, 0]}>
            <mesh position={[0, -0.18, 0]} castShadow>
              <capsuleGeometry args={[0.055, 0.28, 5, 10]} />
              {limbMaterial}
            </mesh>
            <mesh position={[0, -0.35, 0.04]} scale={[1, 0.7, 1.4]} castShadow>
              <sphereGeometry args={[0.095, 14, 10]} />
              {limbMaterial}
            </mesh>
          </group>
          <group ref={rightLeg} position={[0.14, 0.46, 0]}>
            <mesh position={[0, -0.18, 0]} castShadow>
              <capsuleGeometry args={[0.055, 0.28, 5, 10]} />
              {limbMaterial}
            </mesh>
            <mesh position={[0, -0.35, 0.04]} scale={[1, 0.7, 1.4]} castShadow>
              <sphereGeometry args={[0.095, 14, 10]} />
              {limbMaterial}
            </mesh>
          </group>
        </group>

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
          <circleGeometry args={[0.36, 20]} />
          <meshBasicMaterial color='#000000' transparent opacity={0.28} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]}>
          <ringGeometry args={[0.32, 0.38, 32]} />
          <meshBasicMaterial color={colors.accent} transparent opacity={0.82} depthWrite={false} />
        </mesh>
        <Html center position={[0, 2.55, 0]} distanceFactor={7}>
          <span className='border-border/70 bg-background/80 text-foreground pointer-events-none rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wider whitespace-nowrap uppercase shadow'>
            {participant === 'local'
              ? 'You'
              : reconnecting
                ? 'Other person · reconnecting'
                : 'Other person'}
          </span>
        </Html>
      </group>
    </group>
  );
}

import { RoundedBox } from '@react-three/drei';
import { useFrame, type ThreeElements } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { Group, MathUtils, Mesh, PointLight } from 'three';

import type { RoomSceneProps } from '../templates/registry';
import { doorTransitionOpenness, resolveDoorTransition, type DoorTransition } from './journey';

type Surface = { readonly color: string; readonly roughness: number; readonly metalness: number };

const limestone = { color: '#c6a879', roughness: 0.84, metalness: 0.02 } as const;
const paleStone = { color: '#dfc89d', roughness: 0.78, metalness: 0.02 } as const;
const darkStone = { color: '#6d654d', roughness: 0.88, metalness: 0.03 } as const;

const PLANTERS = [
  [-3.85, -3.65, 0.86],
  [-2.4, -4.05, 0.7],
  [2.45, -4.05, 0.74],
  [3.85, -3.45, 0.9],
  [-4.02, 3.25, 0.8],
  [4.02, 3.15, 0.84],
] as const;

const POLLEN = [
  [-2.6, 2.8, -1.8],
  [-1.1, 3.25, 1.9],
  [0.8, 2.55, -2.7],
  [2.4, 3.05, 0.9],
  [3.1, 2.35, -1.2],
  [-3.5, 2.2, 1.3],
] as const;

function Box({
  surface,
  ...props
}: Omit<ThreeElements['mesh'], 'material'> & { readonly surface: Surface }) {
  return (
    <mesh receiveShadow {...props}>
      <boxGeometry />
      <meshStandardMaterial {...surface} />
    </mesh>
  );
}

function Arch({
  position,
  rotation = [0, 0, 0],
}: {
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      <Box surface={limestone} position={[-1.28, 1.25, 0]} scale={[0.3, 2.5, 0.42]} />
      <Box surface={limestone} position={[1.28, 1.25, 0]} scale={[0.3, 2.5, 0.42]} />
      <mesh position={[0, 2.48, 0]} castShadow receiveShadow>
        <torusGeometry args={[1.28, 0.15, 10, 32, Math.PI]} />
        <meshStandardMaterial {...limestone} />
      </mesh>
      <Box surface={limestone} position={[0, 2.74, 0]} scale={[2.85, 0.52, 0.42]} />
    </group>
  );
}

function Planter({
  position: [x, z, scale],
  detailed,
}: {
  readonly position: (typeof PLANTERS)[number];
  readonly detailed: boolean;
}) {
  return (
    <group position={[x, 0, z]} scale={scale}>
      <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 0.62, 0.64, 16]} />
        <meshStandardMaterial {...darkStone} />
      </mesh>
      <mesh position={[0, 1.18, 0]} castShadow>
        <sphereGeometry args={[0.76, detailed ? 14 : 8, detailed ? 10 : 6]} />
        <meshStandardMaterial color='#315c39' roughness={0.92} />
      </mesh>
      <mesh position={[-0.35, 1.44, 0.16]} rotation={[0, 0, -0.45]} castShadow>
        <sphereGeometry args={[0.4, detailed ? 12 : 7, detailed ? 8 : 5]} />
        <meshStandardMaterial color='#487a48' roughness={0.9} />
      </mesh>
      <mesh position={[0.38, 1.48, -0.12]} rotation={[0, 0, 0.4]} castShadow>
        <sphereGeometry args={[0.42, detailed ? 12 : 7, detailed ? 8 : 5]} />
        <meshStandardMaterial color='#3d7042' roughness={0.9} />
      </mesh>
      {detailed && (
        <>
          <mesh position={[-0.25, 1.72, 0.3]}>
            <sphereGeometry args={[0.09, 8, 6]} />
            <meshStandardMaterial color='#e69a72' roughness={0.8} />
          </mesh>
          <mesh position={[0.4, 1.67, 0.2]}>
            <sphereGeometry args={[0.08, 8, 6]} />
            <meshStandardMaterial color='#f2c27f' roughness={0.8} />
          </mesh>
        </>
      )}
    </group>
  );
}

export default function DawnAtriumScene({
  admissionPending = false,
  journey = 'waiting',
  quality,
  qualityTier,
  reducedMotion,
}: RoomSceneProps) {
  const water = useRef<Mesh>(null);
  const pollen = useRef<Group>(null);
  const gate = useRef<Group>(null);
  const gateLight = useRef<PointLight>(null);
  const gateAdmission = useRef<DoorTransition>({ kind: 'none', durationMs: 0 });
  const gateAdmissionElapsedMs = useRef(0);
  const animationElapsedSeconds = useRef(0);
  const previousJourney = useRef(journey);
  const previousReducedMotion = useRef(reducedMotion);

  useFrame((_, delta) => {
    animationElapsedSeconds.current += delta;
    if (previousJourney.current !== journey || previousReducedMotion.current !== reducedMotion) {
      const nextGateAdmission = resolveDoorTransition(
        gateAdmission.current,
        previousJourney.current,
        journey,
        reducedMotion,
      );
      if (nextGateAdmission !== gateAdmission.current) {
        gateAdmission.current = nextGateAdmission;
        gateAdmissionElapsedMs.current = 0;
      }
      previousJourney.current = journey;
      previousReducedMotion.current = reducedMotion;
    }

    gateAdmissionElapsedMs.current += delta * 1_000;
    const openness = doorTransitionOpenness(gateAdmission.current, gateAdmissionElapsedMs.current);
    if (gate.current !== null) gate.current.rotation.y = -openness * 1.25;
    if (gateLight.current !== null) {
      gateLight.current.intensity = MathUtils.damp(
        gateLight.current.intensity,
        admissionPending ? 12 : 0,
        6,
        delta,
      );
    }
    if (!reducedMotion && water.current !== null) water.current.rotation.z += delta * 0.025;
    if (!reducedMotion && pollen.current !== null) {
      pollen.current.position.y = Math.sin(animationElapsedSeconds.current * 0.55) * 0.12;
      pollen.current.rotation.y += delta * 0.018;
    }
  });

  const detailed = quality.ambientDetail;

  return (
    <>
      <fog attach='fog' args={['#e7c994', 13, 28]} />
      <ambientLight intensity={qualityTier === 'low' ? 1.1 : 0.72} color='#ffe4ba' />
      <hemisphereLight args={['#9fc9da', '#92724b', 1.25]} />
      <directionalLight
        castShadow={quality.shadows}
        color='#ffd29a'
        intensity={3.1}
        position={[-6.5, 9, 5.5]}
        shadow-mapSize-height={quality.shadowMapSize}
        shadow-mapSize-width={quality.shadowMapSize}
      />
      {quality.lightCount >= 2 && (
        <pointLight color='#ffe1ad' intensity={10} position={[-3.7, 3.2, 3.4]} distance={8} />
      )}
      {quality.lightCount >= 3 && (
        <pointLight color='#a8d8be' intensity={7} position={[3.8, 2.6, -3.5]} distance={7} />
      )}

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <planeGeometry args={[11, 11]} />
        <meshStandardMaterial color='#b7986d' roughness={0.94} />
      </mesh>
      {detailed &&
        [-3.6, -1.8, 0, 1.8, 3.6].flatMap((x) =>
          [-3.6, -1.8, 0, 1.8, 3.6].map((z) => (
            <mesh
              key={`${x}:${z}`}
              receiveShadow
              rotation={[-Math.PI / 2, 0, 0]}
              position={[x, -0.025, z]}
            >
              <planeGeometry args={[1.72, 1.72]} />
              <meshStandardMaterial
                color={(Math.abs(x + z) / 1.8) % 2 === 0 ? '#c5a879' : '#bfa173'}
                roughness={0.92}
              />
            </mesh>
          )),
        )}

      <Box surface={limestone} position={[0, 1.6, -5.1]} scale={[10.6, 3.3, 0.34]} />
      <Box surface={limestone} position={[0, 1.6, 5.1]} scale={[10.6, 3.3, 0.34]} />
      <Box surface={limestone} position={[-5.1, 1.6, 0]} scale={[0.34, 3.3, 10.6]} />
      <Box surface={limestone} position={[5.1, 1.6, -3.2]} scale={[0.34, 3.3, 4]} />
      <Box surface={limestone} position={[5.1, 1.6, 3.2]} scale={[0.34, 3.3, 4]} />
      <Box surface={limestone} position={[5.1, 2.85, 0]} scale={[0.34, 0.8, 2.4]} />

      <Arch position={[-2.8, 0, -4.9]} />
      <Arch position={[2.8, 0, -4.9]} />
      <Arch position={[-2.8, 0, 4.9]} rotation={[0, Math.PI, 0]} />
      <Arch position={[2.8, 0, 4.9]} rotation={[0, Math.PI, 0]} />
      <Arch position={[-4.9, 0, -2.8]} rotation={[0, Math.PI / 2, 0]} />
      <Arch position={[-4.9, 0, 2.8]} rotation={[0, Math.PI / 2, 0]} />

      <RoundedBox args={[3.25, 0.42, 3.25]} radius={0.42} smoothness={4} position={[0, 0.14, 0]}>
        <meshStandardMaterial {...paleStone} />
      </RoundedBox>
      <mesh ref={water} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.38, 0]}>
        <circleGeometry args={[1.35, detailed ? 64 : 32]} />
        <meshPhysicalMaterial
          color='#72b8b6'
          emissive='#3f8f91'
          emissiveIntensity={0.18}
          roughness={0.16}
          metalness={0.08}
          transparent
          opacity={0.82}
        />
      </mesh>
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.36, 0.72, 20]} />
        <meshStandardMaterial {...paleStone} />
      </mesh>
      <mesh position={[0, 1.15, 0]}>
        <sphereGeometry args={[0.19, 16, 12]} />
        <meshStandardMaterial color='#79c6c0' emissive='#4da7a4' emissiveIntensity={0.2} />
      </mesh>

      {PLANTERS.map((position) => (
        <Planter key={`${position[0]}:${position[1]}`} position={position} detailed={detailed} />
      ))}

      <group ref={pollen}>
        {detailed &&
          POLLEN.map(([x, y, z]) => (
            <mesh key={`${x}:${z}`} position={[x, y, z]}>
              <sphereGeometry args={[0.025, 6, 6]} />
              <meshBasicMaterial color='#ffe6a8' toneMapped={false} />
            </mesh>
          ))}
      </group>

      <group ref={gate} position={[5.08, 1.38, 1.08]} rotation={[0, 0, 0]}>
        <group position={[0, 0, -1.04]}>
          <RoundedBox args={[0.12, 2.7, 2.08]} radius={0.04} smoothness={2} castShadow>
            <meshStandardMaterial color='#49624b' roughness={0.55} metalness={0.12} />
          </RoundedBox>
          {[-0.7, 0, 0.7].map((z) => (
            <Box
              key={z}
              surface={{ color: '#b79056', roughness: 0.5, metalness: 0.2 }}
              position={[-0.08, 0, z]}
              scale={[0.08, 2.25, 0.055]}
            />
          ))}
        </group>
      </group>
      <pointLight
        ref={gateLight}
        color='#f5b36c'
        intensity={0}
        position={[4.45, 2.4, 0]}
        distance={4}
      />

      <mesh position={[-3.9, 6.8, -5.8]}>
        <sphereGeometry args={[1.05, 24, 18]} />
        <meshBasicMaterial color='#ffd09a' toneMapped={false} />
      </mesh>
    </>
  );
}

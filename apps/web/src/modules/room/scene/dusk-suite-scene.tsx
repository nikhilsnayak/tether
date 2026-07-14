import { RoundedBox } from '@react-three/drei';
import { useFrame, type ThreeElements } from '@react-three/fiber/webgpu';
import { useEffect, useRef, useState } from 'react';
import { Color, Group, MathUtils, Mesh, MeshBasicMaterial, PointLight } from 'three';

import type { RoomSceneProps } from '../templates/registry';
import {
  doorTransition,
  doorTransitionOpenness,
  type DoorTransition,
  type RoomJourneyCue,
} from './journey';
import { createRemoteVideoSurface, containedVideoSize } from './remote-media';

const wallMaterial = { color: '#18191d', roughness: 0.82, metalness: 0.04 } as const;
const trimMaterial = { color: '#29282a', roughness: 0.5, metalness: 0.18 } as const;
type Surface = { readonly color: string; readonly roughness: number; readonly metalness: number };

const DISPLAY_SIZE = [6.5, 3.66] as const;
const DISPLAY_COLORS = {
  waiting: new Color('#071026'),
  outside: new Color('#08090c'),
  connecting: new Color('#0b1830'),
  stalled: new Color('#24170d'),
  together: new Color('#071026'),
  reconnecting: new Color('#20120c'),
  departed: new Color('#08090c'),
  ended: new Color('#08090c'),
} as const;

function RemoteVideoDisplay({
  stream,
  journey,
}: {
  readonly stream: MediaStream;
  readonly journey: RoomJourneyCue;
}) {
  const [surface, setSurface] = useState<ReturnType<typeof createRemoteVideoSurface> | null>(null);
  const [videoSize, setVideoSize] = useState<readonly [number, number]>(DISPLAY_SIZE);
  const material = useRef<MeshBasicMaterial>(null);
  const reconnectStartedAt = useRef<number | null>(null);
  const previousJourney = useRef<RoomJourneyCue | null>(null);

  useFrame((_, delta) => {
    if (previousJourney.current !== journey) {
      reconnectStartedAt.current = journey === 'reconnecting' ? performance.now() : null;
      previousJourney.current = journey;
    }
    const videoMaterial = material.current;
    if (videoMaterial === null) return;
    const reconnectElapsed =
      reconnectStartedAt.current === null ? 0 : performance.now() - reconnectStartedAt.current;
    const targetOpacity = journey === 'reconnecting' && reconnectElapsed > 1_500 ? 0 : 1;
    videoMaterial.opacity = MathUtils.damp(videoMaterial.opacity, targetOpacity, 8, delta);
  });

  useEffect(() => {
    const next = createRemoteVideoSurface(stream);
    const updateSize = () => {
      setVideoSize(
        containedVideoSize(
          next.element.videoWidth,
          next.element.videoHeight,
          DISPLAY_SIZE[0],
          DISPLAY_SIZE[1],
        ),
      );
    };
    next.element.addEventListener('loadedmetadata', updateSize);
    setSurface(next);
    return () => {
      next.element.removeEventListener('loadedmetadata', updateSize);
      next.dispose();
    };
  }, [stream]);

  if (surface === null) return null;
  return (
    <mesh position={[0, 2.35, -4.595]} scale={[videoSize[0], videoSize[1], 1]}>
      <planeGeometry />
      <meshBasicMaterial ref={material} map={surface.texture} toneMapped={false} transparent />
    </mesh>
  );
}

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

export default function DuskSuiteScene({
  admissionPending = false,
  journey = 'waiting',
  quality,
  qualityTier,
  reducedMotion,
  remoteStream,
}: RoomSceneProps) {
  const detailed = quality.ambientDetail;
  const displayMaterial = useRef<MeshBasicMaterial>(null);
  const door = useRef<Group>(null);
  const doorLight = useRef<PointLight>(null);
  const doorAdmission = useRef<DoorTransition>({ kind: 'none', durationMs: 0 });
  const doorAdmissionElapsedMs = useRef(0);
  const previousJourney = useRef(journey);
  const previousReducedMotion = useRef(reducedMotion);
  const signal = useRef<Group>(null);

  useFrame((_, delta) => {
    if (previousJourney.current !== journey || previousReducedMotion.current !== reducedMotion) {
      doorAdmission.current = doorTransition(previousJourney.current, journey, reducedMotion);
      doorAdmissionElapsedMs.current = 0;
      previousJourney.current = journey;
      previousReducedMotion.current = reducedMotion;
    }

    const material = displayMaterial.current;
    if (material !== null) {
      material.color.lerp(DISPLAY_COLORS[journey], 1 - Math.exp(-delta * 7));
    }
    const doorGroup = door.current;
    if (doorGroup !== null) {
      doorAdmissionElapsedMs.current += delta * 1_000;
      const openness = doorTransitionOpenness(
        doorAdmission.current,
        doorAdmissionElapsedMs.current,
      );
      doorGroup.rotation.y = -Math.PI / 2 - openness * 0.82;
    }
    const light = doorLight.current;
    if (light !== null)
      light.intensity = MathUtils.damp(light.intensity, admissionPending ? 7 : 0, 6, delta);
    const signalOpacity =
      journey === 'reconnecting' || journey === 'stalled'
        ? 0.08 + Math.sin((performance.now() / 1_000) * 3) * 0.035
        : 0;
    signal.current?.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof MeshBasicMaterial) {
        object.material.opacity = signalOpacity;
      }
    });
  });

  return (
    <>
      <fog attach='fog' args={['#090b13', 9, 22]} />

      <ambientLight intensity={qualityTier === 'low' ? 0.58 : 0.38} color='#9caed0' />
      <directionalLight
        castShadow={quality.shadows}
        color='#e2e9ff'
        intensity={1.15}
        position={[-3.8, 5.6, 2.8]}
        shadow-mapSize-height={quality.shadowMapSize}
        shadow-mapSize-width={quality.shadowMapSize}
      />
      {quality.lightCount >= 2 && (
        <pointLight color='#ff9f63' intensity={18} position={[3.7, 3.35, -2.8]} distance={8} />
      )}
      {quality.lightCount >= 3 && (
        <pointLight color='#698dff' intensity={11} position={[-4.2, 2.7, -0.8]} distance={7} />
      )}
      {journey === 'outside' && (
        <>
          <pointLight color='#f2d7b8' intensity={18} position={[7.2, 4.05, 1.65]} distance={8} />
          <pointLight color='#7894cf' intensity={6} position={[8.2, 1.1, -0.8]} distance={7} />
        </>
      )}

      <Box surface={wallMaterial} position={[0, -0.12, 0]} scale={[10, 0.24, 12]} />
      <Box surface={wallMaterial} position={[0, 4.65, 0]} scale={[10, 0.2, 12]} />
      <Box surface={wallMaterial} position={[0, 2.25, -4.9]} scale={[10, 4.8, 0.2]} />
      <Box surface={wallMaterial} position={[4.9, 2.25, -2.04]} scale={[0.2, 4.8, 5.72]} />
      <Box surface={wallMaterial} position={[4.9, 2.25, 3.69]} scale={[0.2, 4.8, 2.62]} />
      <Box surface={wallMaterial} position={[4.9, 3.75, 1.65]} scale={[0.2, 1.8, 1.45]} />

      <Box
        surface={{ color: '#171a21', roughness: 0.88, metalness: 0.02 }}
        position={[7.2, -0.12, 1.65]}
        scale={[4.6, 0.24, 6.2]}
      />
      <Box
        surface={{ color: '#11141a', roughness: 0.9, metalness: 0.01 }}
        position={[7.2, 4.65, 1.65]}
        scale={[4.6, 0.2, 6.2]}
      />
      <Box
        surface={{ color: '#14171d', roughness: 0.9, metalness: 0.02 }}
        position={[7.2, 2.25, -1.45]}
        scale={[4.6, 4.8, 0.2]}
      />
      <Box
        surface={{ color: '#14171d', roughness: 0.9, metalness: 0.02 }}
        position={[7.2, 2.25, 4.75]}
        scale={[4.6, 4.8, 0.2]}
      />
      <Box surface={trimMaterial} position={[5.04, 2.8, 1.65]} scale={[0.18, 0.12, 1.7]} />
      <Box surface={trimMaterial} position={[5.04, 1.4, 0.89]} scale={[0.18, 2.9, 0.1]} />
      <Box surface={trimMaterial} position={[5.04, 1.4, 2.41]} scale={[0.18, 2.9, 0.1]} />
      <RoundedBox args={[1.7, 0.08, 0.55]} position={[7.15, 4.5, 1.65]}>
        <meshStandardMaterial color='#f2d7b8' emissive='#f2d7b8' emissiveIntensity={2.2} />
      </RoundedBox>
      <mesh position={[5.85, 0.02, 1.65]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.35, 0.9]} />
        <meshStandardMaterial color='#40362f' roughness={0.95} />
      </mesh>

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <planeGeometry args={[9.7, 9.7]} />
        <meshStandardMaterial color='#202126' roughness={0.72} metalness={0.08} />
      </mesh>

      <group position={[-4.78, 2.25, -0.8]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <planeGeometry args={[3.75, 3.75]} />
          <meshBasicMaterial color='#263a69' />
        </mesh>
        <mesh position={[0, -1.28, 0.012]}>
          <planeGeometry args={[3.6, 1.15]} />
          <meshBasicMaterial color='#11182a' />
        </mesh>
        {detailed && (
          <>
            <Box surface={trimMaterial} position={[0, 0, 0.04]} scale={[0.07, 3.8, 0.08]} />
            <Box surface={trimMaterial} position={[0, 0, 0.04]} scale={[3.8, 0.07, 0.08]} />
          </>
        )}
      </group>

      <RoundedBox
        args={[6.85, 3.95, 0.18]}
        radius={0.08}
        smoothness={3}
        position={[0, 2.35, -4.72]}
        castShadow
      >
        <meshStandardMaterial color='#090a0c' roughness={0.3} metalness={0.55} />
      </RoundedBox>
      <mesh position={[0, 2.35, -4.61]}>
        <planeGeometry args={[...DISPLAY_SIZE]} />
        <meshBasicMaterial ref={displayMaterial} color='#071026' toneMapped={false} />
      </mesh>
      <group ref={signal} position={[0, 2.35, -4.595]}>
        {[-0.7, 0, 0.7].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <planeGeometry args={[5.7, 0.035]} />
            <meshBasicMaterial color='#f4b276' transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>
      {remoteStream !== undefined && remoteStream !== null && (
        <RemoteVideoDisplay stream={remoteStream} journey={journey} />
      )}

      <RoundedBox
        args={[6.55, 0.58, 0.78]}
        radius={0.09}
        smoothness={3}
        position={[0, 0.5, -4.12]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial {...trimMaterial} />
      </RoundedBox>
      {detailed && (
        <>
          <mesh position={[-1.75, 0.82, -4]}>
            <cylinderGeometry args={[0.16, 0.19, 0.12, 20]} />
            <meshStandardMaterial color='#3d3027' roughness={0.65} />
          </mesh>
          <mesh position={[1.8, 0.84, -4.03]} rotation={[-0.1, 0.1, 0]}>
            <boxGeometry args={[0.72, 0.06, 0.48]} />
            <meshStandardMaterial color='#393a3e' roughness={0.8} />
          </mesh>
        </>
      )}

      <group ref={door} position={[4.9, 1.35, 2.375]} rotation={[0, -Math.PI / 2, 0]}>
        <group position={[-0.725, 0, 0]}>
          <RoundedBox args={[1.45, 2.8, 0.14]} radius={0.015} smoothness={2} castShadow>
            <meshStandardMaterial color='#493a32' roughness={0.68} metalness={0.04} />
          </RoundedBox>
          <Box
            surface={{ color: '#342a25', roughness: 0.72, metalness: 0.03 }}
            position={[0, 0.56, -0.085]}
            scale={[1.05, 0.82, 0.04]}
          />
          <Box
            surface={{ color: '#342a25', roughness: 0.72, metalness: 0.03 }}
            position={[0, -0.56, -0.085]}
            scale={[1.05, 0.82, 0.04]}
          />
          <mesh position={[-0.5, 0, -0.13]}>
            <sphereGeometry args={[0.055, 12, 12]} />
            <meshStandardMaterial color='#e0ae72' metalness={0.75} roughness={0.2} />
          </mesh>
        </group>
      </group>
      <pointLight
        ref={doorLight}
        color='#f0a65f'
        intensity={0}
        position={[4.35, 2.85, 1.65]}
        distance={3.2}
      />

      <Box surface={trimMaterial} position={[3.78, 3.75, -2.8]} scale={[1.5, 0.08, 0.42]} />
      <mesh position={[3.78, 3.68, -2.8]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.25, 0.24]} />
        <meshBasicMaterial color='#ffc28f' />
      </mesh>
    </>
  );
}

import { RoundedBox } from '@react-three/drei';
import type { ThreeElements } from '@react-three/fiber/webgpu';
import { useEffect, useState } from 'react';

import type { RoomSceneProps } from '../templates/registry';
import { createRemoteVideoSurface, containedVideoSize } from './remote-media';

const wallMaterial = { color: '#18191d', roughness: 0.82, metalness: 0.04 } as const;
const trimMaterial = { color: '#29282a', roughness: 0.5, metalness: 0.18 } as const;
type Surface = { readonly color: string; readonly roughness: number; readonly metalness: number };

const DISPLAY_SIZE = [6.5, 3.66] as const;

function RemoteVideoDisplay({ stream }: { readonly stream: MediaStream }) {
  const [surface, setSurface] = useState<ReturnType<typeof createRemoteVideoSurface> | null>(null);
  const [videoSize, setVideoSize] = useState<readonly [number, number]>(DISPLAY_SIZE);

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
      <meshBasicMaterial map={surface.texture} toneMapped={false} />
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

export default function DuskSuiteScene({ quality, qualityTier, remoteStream }: RoomSceneProps) {
  const detailed = quality.ambientDetail;

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

      <Box surface={wallMaterial} position={[0, -0.12, 0]} scale={[10, 0.24, 12]} />
      <Box surface={wallMaterial} position={[0, 4.65, 0]} scale={[10, 0.2, 12]} />
      <Box surface={wallMaterial} position={[0, 2.25, -4.9]} scale={[10, 4.8, 0.2]} />
      <Box surface={wallMaterial} position={[4.9, 2.25, 0]} scale={[0.2, 4.8, 10]} />

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
        <meshBasicMaterial color='#071026' toneMapped={false} />
      </mesh>
      {remoteStream !== undefined && remoteStream !== null && (
        <RemoteVideoDisplay stream={remoteStream} />
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

      <group position={[4.78, 1.35, 1.65]} rotation={[0, -Math.PI / 2, 0]}>
        <RoundedBox args={[1.45, 2.75, 0.14]} radius={0.035} smoothness={2} castShadow>
          <meshStandardMaterial color='#252326' roughness={0.62} metalness={0.08} />
        </RoundedBox>
        <mesh position={[-0.5, 0, 0.1]}>
          <sphereGeometry args={[0.055, 12, 12]} />
          <meshStandardMaterial color='#ae8051' metalness={0.75} roughness={0.25} />
        </mesh>
      </group>

      <Box surface={trimMaterial} position={[3.78, 3.75, -2.8]} scale={[1.5, 0.08, 0.42]} />
      <mesh position={[3.78, 3.68, -2.8]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.25, 0.24]} />
        <meshBasicMaterial color='#ffc28f' />
      </mesh>
    </>
  );
}

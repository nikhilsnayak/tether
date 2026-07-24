import { useFrame, type ThreeElements } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import {
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Object3D,
  PointLight,
} from 'three';

import type { RoomSceneProps } from '../templates/registry';
import { doorTransitionOpenness, resolveDoorTransition, type DoorTransition } from './journey';

type Surface = { readonly color: string; readonly roughness: number; readonly metalness: number };

const limestone = { color: '#b8ab91', roughness: 0.9, metalness: 0.01 } as const;
const paleStone = { color: '#d2c7af', roughness: 0.86, metalness: 0.01 } as const;
const darkStone = { color: '#666155', roughness: 0.94, metalness: 0.01 } as const;
const recessedStone = { color: '#756f61', roughness: 0.96, metalness: 0 } as const;
const agedBronze = { color: '#625c43', roughness: 0.6, metalness: 0.38 } as const;

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

const FLOOR_COORDINATES = [-3.6, -1.8, 0, 1.8, 3.6] as const;
const FLOOR_COLORS = ['#b9ab91', '#c2b49a', '#b4a68d', '#c8baa0', '#ada188'] as const;
const LEAVES = [
  [-0.34, 1.22, 0.05, -0.5, 0.25, 0.22, '#375c3b'],
  [0.34, 1.3, -0.08, 0.48, -0.2, 0.24, '#416b43'],
  [-0.12, 1.52, 0.22, -0.2, 0.42, 0.2, '#4c7549'],
  [0.15, 1.7, -0.1, 0.24, -0.35, 0.18, '#315438'],
  [-0.48, 1.55, -0.18, -0.72, -0.3, 0.18, '#456c43'],
  [0.5, 1.54, 0.18, 0.74, 0.34, 0.19, '#537a4d'],
  [0, 1.92, 0.04, 0.04, 0.12, 0.17, '#3b633f'],
] as const;
const FLOWERS = [
  [-0.24, 1.72, 0.28, '#c98363'],
  [0.35, 1.5, 0.26, '#dfb16d'],
  [0.08, 1.98, 0.05, '#d69a70'],
] as const;
const DISTANT_TREES = [
  [1.2, -5.8, 1.05],
  [0.2, -3.4, 0.82],
  [0.8, -0.9, 0.95],
  [0.1, 1.8, 0.78],
  [1.1, 4.4, 1],
  [0.4, 6.1, 0.84],
] as const;
const TREE_CANOPY = [
  [-0.5, 4.15, 0, 0.92],
  [0.38, 4.42, -0.12, 1],
  [0.04, 5.05, 0.08, 0.84],
] as const;
// Landscape ringing the courtyard so the exterior reads as a garden rather than
// a void. Kept clear of the +x entrance approach; all of it fades into fog.
// [x, z, scale, isTree]
const EXTERIOR_SCENERY = [
  [-15, -6, 4.4, true],
  [-19, 6, 5, false],
  [-21, -13, 4.6, true],
  [-13, 14, 4, false],
  [-23, 15, 4.2, true],
  [-7, 21, 4.6, false],
  [4, 23, 5.2, true],
  [13, 19, 4.2, false],
  [19, 11, 5, true],
  [23, -5, 4.4, false],
  [17, -15, 5.2, true],
  [6, -22, 4.6, false],
  [-5, -25, 5, true],
  [25, 5, 3.8, false],
] as const;

// Detuned speeds keep the pool ripples and cascade pulses from marching in
// lockstep, which is what read as mechanical.
const RIPPLE_SPEEDS = [0.3, 0.37, 0.245] as const;
const RIPPLE_OFFSETS = [0, 0.44, 0.72] as const;
const CASCADE_PULSE_SPEEDS = [0.85, 1.06] as const;
const CASCADE_PULSE_OFFSETS = [0, 0.5] as const;

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
      <mesh position={[0, 0.64, -0.17]} receiveShadow>
        <planeGeometry args={[2.25, 1.28]} />
        <meshStandardMaterial {...recessedStone} />
      </mesh>
      <mesh position={[0, 1.27, -0.17]} receiveShadow>
        <circleGeometry args={[1.125, 32, 0, Math.PI]} />
        <meshStandardMaterial {...recessedStone} />
      </mesh>
      <Box castShadow surface={limestone} position={[-1.28, 1.25, 0]} scale={[0.3, 2.5, 0.46]} />
      <Box castShadow surface={limestone} position={[1.28, 1.25, 0]} scale={[0.3, 2.5, 0.46]} />
      {[-1.28, 1.28].map((x) => (
        <group key={x}>
          <Box surface={paleStone} position={[x, 0.14, 0]} scale={[0.5, 0.28, 0.58]} />
          <Box surface={paleStone} position={[x, 2.38, 0]} scale={[0.52, 0.18, 0.58]} />
        </group>
      ))}
      <mesh position={[0, 2.48, 0]} castShadow receiveShadow>
        <torusGeometry args={[1.28, 0.15, 12, 40, Math.PI]} />
        <meshStandardMaterial {...limestone} />
      </mesh>
      <Box castShadow surface={limestone} position={[0, 2.74, 0]} scale={[2.85, 0.52, 0.46]} />
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
    <group position={[x, 0, z]} rotation={[0, (x * 0.37 + z * 0.23) % Math.PI, 0]} scale={scale}>
      <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.68, 0.58, 0.64, 20]} />
        <meshStandardMaterial {...darkStone} />
      </mesh>
      <mesh position={[0, 0.65, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.61, 0.07, 8, 24]} />
        <meshStandardMaterial {...paleStone} />
      </mesh>
      <mesh position={[0, 0.67, 0]}>
        <cylinderGeometry args={[0.52, 0.52, 0.025, 20]} />
        <meshStandardMaterial color='#4c4031' roughness={1} />
      </mesh>
      <mesh position={[0, 1.18, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.09, 1.08, 8]} />
        <meshStandardMaterial color='#5a4633' roughness={0.95} />
      </mesh>
      {LEAVES.filter((_, index) => detailed || index % 2 === 0).map(
        ([leafX, leafY, leafZ, rotationZ, rotationY, leafScale, color], index) => (
          <mesh
            key={index}
            position={[leafX, leafY, leafZ]}
            rotation={[0.18, rotationY, rotationZ]}
            scale={[leafScale, leafScale * 1.9, leafScale * 0.48]}
            castShadow
          >
            <sphereGeometry args={[1, detailed ? 12 : 8, detailed ? 8 : 6]} />
            <meshStandardMaterial color={color} roughness={0.96} />
          </mesh>
        ),
      )}
      {detailed &&
        FLOWERS.map(([flowerX, flowerY, flowerZ, color], index) => (
          <mesh key={index} position={[flowerX, flowerY, flowerZ]}>
            <sphereGeometry args={[0.065, 8, 6]} />
            <meshStandardMaterial color={color} roughness={0.86} />
          </mesh>
        ))}
    </group>
  );
}

// The spray is a ballistic particle system: each droplet is launched from the
// nozzle within a cone and falls under gravity, so the fan and mist emerge from
// the physics rather than being drawn as fixed arcs.
const SPRAY_ORIGIN_Y = 1.28;
const SPRAY_POOL_Y = 0.46;
const SPRAY_GRAVITY = 11;
// Foam churning where the burst lands, scattered on a golden-angle spiral.
const FROTH_COUNT = 20;
const GOLDEN_ANGLE = 2.399963;

// Cheap deterministic hash so the spray looks the same every run (and freezes
// cleanly under reduced motion) without a real PRNG.
const hashUnit = (index: number, seed: number): number => {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

type Jet = {
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly life: number;
  readonly offset: number;
  readonly size: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

type Froth = {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly speed: number;
  readonly phase: number;
};

function buildJets(detailed: boolean): Jet[] {
  const count = detailed ? 1560 : 540;
  const fall = SPRAY_ORIGIN_Y - SPRAY_POOL_Y;
  const jets: Jet[] = [];
  for (let index = 0; index < count; index += 1) {
    const azimuth = hashUnit(index, 1) * Math.PI * 2;
    // Elevation biased toward vertical: a dense central plume plus lower,
    // wider arcs form the umbrella. Squaring pushes more droplets upright.
    const elevation = 0.62 + (1 - hashUnit(index, 2) ** 2) * 0.95;
    const speed = 2.1 + hashUnit(index, 3) * 1.6;
    const horizontal = Math.cos(elevation) * speed;
    const shade = hashUnit(index, 5);
    jets.push({
      vx: horizontal * Math.cos(azimuth),
      vz: horizontal * Math.sin(azimuth),
      vy: Math.sin(elevation) * speed,
      life:
        (Math.sin(elevation) * speed +
          Math.sqrt((Math.sin(elevation) * speed) ** 2 + 2 * SPRAY_GRAVITY * fall)) /
        SPRAY_GRAVITY,
      offset: hashUnit(index, 4),
      size: 0.008 + hashUnit(index, 6) * 0.011,
      r: 0.72 + shade * 0.2,
      g: 0.85 + shade * 0.13,
      b: 0.9 + shade * 0.1,
    });
  }
  return jets;
}

const sprayDummy = new Object3D();
const sprayTint = new Color();

function FountainSpray({
  detailed,
  reducedMotion,
}: {
  readonly detailed: boolean;
  readonly reducedMotion: boolean;
}) {
  const instances = useRef<InstancedMesh>(null);
  const froths = useRef<(Mesh | null)[]>([]);
  const elapsed = useRef(0);
  const jets = buildJets(detailed);

  const frothData: Froth[] = [];
  for (let index = 0; index < FROTH_COUNT; index += 1) {
    const angle = index * GOLDEN_ANGLE;
    const radius = 0.14 + (index / FROTH_COUNT) * 0.5;
    frothData.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      scale: 0.06 + (index % 3) * 0.02,
      speed: 1.5 + (index % 4) * 0.22,
      phase: index * 0.7,
    });
  }

  useFrame((_, delta) => {
    const mesh = instances.current;
    if (mesh != null) {
      if (!reducedMotion) elapsed.current += delta;
      const time = elapsed.current;
      for (let index = 0; index < jets.length; index += 1) {
        const jet = jets[index]!;
        const t = ((time * 0.9 + jet.offset) % 1) * jet.life;
        // Rises fast then thins to nothing: droplets are born and die as mist.
        const fade = Math.sin((t / jet.life) * Math.PI);
        sprayDummy.position.set(
          jet.vx * t,
          SPRAY_ORIGIN_Y + jet.vy * t - 0.5 * SPRAY_GRAVITY * t * t,
          jet.vz * t,
        );
        sprayDummy.scale.setScalar(Math.max(0.0001, jet.size * (0.35 + fade * 0.95)));
        sprayDummy.updateMatrix();
        mesh.setMatrixAt(index, sprayDummy.matrix);
        const brightness = 0.55 + fade * 0.45;
        sprayTint.setRGB(jet.r * brightness, jet.g * brightness, jet.b * brightness);
        mesh.setColorAt(index, sprayTint);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor != null) mesh.instanceColor.needsUpdate = true;
    }
    if (reducedMotion) return;
    for (let index = 0; index < frothData.length; index += 1) {
      const froth = froths.current[index];
      const data = frothData[index];
      if (froth == null || data == null) continue;
      const t = elapsed.current * data.speed + data.phase;
      const pulse = 0.5 + 0.5 * Math.sin(t);
      froth.position.y = SPRAY_POOL_Y + 0.02 + Math.sin(t * 1.3) * 0.02;
      froth.scale.set(
        data.scale * (0.8 + pulse * 0.6),
        data.scale * 0.45,
        data.scale * (0.8 + pulse * 0.6),
      );
      (froth.material as MeshBasicMaterial).opacity = 0.12 + pulse * 0.4;
    }
  });

  return (
    <group>
      <instancedMesh
        ref={instances}
        args={[undefined, undefined, jets.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 6, 5]} />
        <meshBasicMaterial
          color='#eef9ff'
          transparent
          opacity={0.42}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      {detailed &&
        frothData.map((data, index) => (
          <mesh
            key={index}
            ref={(mesh: Mesh | null) => {
              froths.current[index] = mesh;
            }}
            position={[data.x, SPRAY_POOL_Y, data.z]}
            scale={0.001}
          >
            <sphereGeometry args={[1, 6, 5]} />
            <meshBasicMaterial
              color='#eafdff'
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ))}
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
  const cascade = useRef<MeshPhysicalMaterial>(null);
  const ripples = useRef<(Mesh | null)[]>([]);
  const cascadePulses = useRef<(Mesh | null)[]>([]);
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
    if (!reducedMotion) {
      const elapsed = animationElapsedSeconds.current;
      for (let index = 0; index < ripples.current.length; index += 1) {
        const ring = ripples.current[index];
        if (ring == null) continue;
        const phase =
          (elapsed * RIPPLE_SPEEDS[index % RIPPLE_SPEEDS.length]! +
            RIPPLE_OFFSETS[index % RIPPLE_OFFSETS.length]!) %
          1;
        const radius = 0.22 + phase * 1.28;
        ring.scale.set(radius, radius, 1);
        // pow softens the crisp bright band into something closer to a swell.
        (ring.material as MeshBasicMaterial).opacity = Math.sin(phase * Math.PI) ** 1.5 * 0.24;
      }
      for (let index = 0; index < cascadePulses.current.length; index += 1) {
        const pulse = cascadePulses.current[index];
        if (pulse == null) continue;
        const phase =
          (elapsed * CASCADE_PULSE_SPEEDS[index % CASCADE_PULSE_SPEEDS.length]! +
            CASCADE_PULSE_OFFSETS[index % CASCADE_PULSE_OFFSETS.length]!) %
          1;
        // A band of water sliding down the sheet: born at the lip, dies in the pool.
        pulse.position.y = 1.04 - phase * 0.58;
        (pulse.material as MeshBasicMaterial).opacity = Math.sin(phase * Math.PI) * 0.32;
      }
      if (cascade.current !== null) {
        cascade.current.opacity =
          0.4 + Math.sin(elapsed * 2.6) * 0.05 + Math.sin(elapsed * 5.9 + 1.3) * 0.025;
      }
    }
    if (!reducedMotion && pollen.current !== null) {
      pollen.current.position.y = Math.sin(animationElapsedSeconds.current * 0.55) * 0.12;
      pollen.current.rotation.y += delta * 0.018;
    }
  });

  const detailed = quality.ambientDetail;

  return (
    <>
      <fog attach='fog' args={['#b8c8c5', 19, 38]} />
      <ambientLight intensity={qualityTier === 'low' ? 0.9 : 0.56} color='#f4e6cf' />
      <hemisphereLight args={['#a8c7cf', '#716a59', 0.92]} />
      <directionalLight
        castShadow={quality.shadows}
        color='#f7ddbb'
        intensity={2.35}
        position={[-7.5, 10.5, 6.5]}
        shadow-mapSize-height={quality.shadowMapSize}
        shadow-mapSize-width={quality.shadowMapSize}
      />
      {quality.lightCount >= 2 && (
        <pointLight color='#ead4ad' intensity={4.5} position={[-3.7, 2.8, 3.4]} distance={8} />
      )}
      {quality.lightCount >= 3 && (
        <pointLight color='#b7cec1' intensity={3.5} position={[3.8, 2.4, -3.5]} distance={7} />
      )}
      {journey === 'outside' && (
        <>
          <directionalLight color='#f4dfbd' intensity={1.7} position={[10, 8, 4]} />
          <pointLight color='#e8d2ae' intensity={7} position={[7.5, 3.2, 0]} distance={8} />
        </>
      )}

      {DISTANT_TREES.filter((_, index) => detailed || index % 2 === 0).map(
        ([x, z, scale], index) => (
          <group key={`${x}:${z}`} position={[x, 0, z]} scale={scale}>
            <mesh position={[0, 2.05, 0]} castShadow>
              <cylinderGeometry args={[0.16, 0.25, 4.1, 9]} />
              <meshStandardMaterial color='#51483a' roughness={1} />
            </mesh>
            {TREE_CANOPY.map(([canopyX, canopyY, canopyZ, canopyScale], canopyIndex) => (
              <mesh
                key={canopyIndex}
                position={[canopyX, canopyY, canopyZ]}
                scale={[canopyScale, canopyScale * 0.72, canopyScale * 0.82]}
                castShadow
              >
                <sphereGeometry args={[1, detailed ? 14 : 9, detailed ? 9 : 6]} />
                <meshStandardMaterial
                  color={(index + canopyIndex) % 2 === 0 ? '#365845' : '#456651'}
                  roughness={1}
                />
              </mesh>
            ))}
          </group>
        ),
      )}

      {/* Surrounding terrain so the courtyard sits in a landscape rather than
          floating in the void; it fades into fog well before its edge. */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.14, 0]}>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color='#8b9173' roughness={1} />
      </mesh>
      {EXTERIOR_SCENERY.map(([x, z, scale, isTree], index) =>
        isTree ? (
          <group key={`${x}:${z}`} position={[x, -0.14, z]} scale={scale}>
            <mesh position={[0, 1.05, 0]} castShadow>
              <cylinderGeometry args={[0.12, 0.2, 2.1, 7]} />
              <meshStandardMaterial color='#4c4436' roughness={1} />
            </mesh>
            <mesh position={[0, 2.4, 0]} scale={[1, 0.86, 1]} castShadow>
              <sphereGeometry args={[1, 10, 8]} />
              <meshStandardMaterial color={index % 2 === 0 ? '#3f5f43' : '#4f6a4b'} roughness={1} />
            </mesh>
          </group>
        ) : (
          <mesh
            key={`${x}:${z}`}
            position={[x, -0.14 + scale * 0.32, z]}
            scale={[scale, scale * 0.82, scale]}
            castShadow
          >
            <sphereGeometry args={[1, 10, 8]} />
            <meshStandardMaterial color={index % 2 === 0 ? '#5d7050' : '#67785a'} roughness={1} />
          </mesh>
        ),
      )}

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <planeGeometry args={[11, 11]} />
        <meshStandardMaterial color='#8f8674' roughness={0.98} />
      </mesh>
      {detailed &&
        FLOOR_COORDINATES.flatMap((x, xIndex) =>
          FLOOR_COORDINATES.map((z, zIndex) => (
            <mesh
              key={`${x}:${z}`}
              receiveShadow
              rotation={[-Math.PI / 2, 0, 0]}
              position={[x, -0.025, z]}
            >
              <planeGeometry args={[1.7, 1.7]} />
              <meshStandardMaterial
                color={FLOOR_COLORS[(xIndex * 3 + zIndex * 2) % FLOOR_COLORS.length]}
                roughness={0.96}
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
      <Box surface={paleStone} position={[0, 3.31, -5.1]} scale={[10.8, 0.18, 0.48]} />
      <Box surface={paleStone} position={[0, 3.31, 5.1]} scale={[10.8, 0.18, 0.48]} />
      <Box surface={paleStone} position={[-5.1, 3.31, 0]} scale={[0.48, 0.18, 10.8]} />
      <Box surface={paleStone} position={[5.1, 3.31, -3.2]} scale={[0.48, 0.18, 4.2]} />
      <Box surface={paleStone} position={[5.1, 3.31, 3.2]} scale={[0.48, 0.18, 4.2]} />
      <Box surface={paleStone} position={[5.1, 3.31, 0]} scale={[0.48, 0.18, 2.5]} />
      <Box surface={paleStone} position={[5.28, 1.42, -1.34]} scale={[0.48, 2.92, 0.34]} />
      <Box surface={paleStone} position={[5.28, 1.42, 1.34]} scale={[0.48, 2.92, 0.34]} />
      <Box surface={paleStone} position={[5.28, 2.92, 0]} scale={[0.48, 0.28, 3]} />
      <Box surface={darkStone} position={[5.55, 0.08, 0]} scale={[0.9, 0.16, 2.9]} />

      <Arch position={[-2.8, 0, -4.9]} />
      <Arch position={[2.8, 0, -4.9]} />
      <Arch position={[-2.8, 0, 4.9]} rotation={[0, Math.PI, 0]} />
      <Arch position={[2.8, 0, 4.9]} rotation={[0, Math.PI, 0]} />
      <Arch position={[-4.9, 0, -2.8]} rotation={[0, Math.PI / 2, 0]} />
      <Arch position={[-4.9, 0, 2.8]} rotation={[0, Math.PI / 2, 0]} />

      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.75, 1.82, 0.32, detailed ? 48 : 24]} />
        <meshStandardMaterial {...paleStone} />
      </mesh>
      <mesh position={[0, 0.27, 0]} receiveShadow>
        <cylinderGeometry args={[1.47, 1.56, 0.18, detailed ? 48 : 24]} />
        <meshStandardMaterial color='#4f625f' roughness={0.82} />
      </mesh>
      <mesh position={[0, 0.37, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[1.61, 0.15, 10, detailed ? 48 : 24]} />
        <meshStandardMaterial {...paleStone} />
      </mesh>
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.375, 0]}>
          <circleGeometry args={[1.46, detailed ? 64 : 32]} />
          <meshPhysicalMaterial
            color='#5f8d88'
            roughness={0.14}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.06}
            transparent
            opacity={0.82}
          />
        </mesh>
        {Array.from({ length: detailed ? 3 : 2 }).map((_, index) => (
          <mesh
            key={index}
            ref={(mesh: Mesh | null) => {
              ripples.current[index] = mesh;
            }}
            position={[0, 0.386, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <torusGeometry args={[1, 0.006, 6, 48]} />
            <meshBasicMaterial
              color='#a7cbc4'
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.3, 0.7, 20]} />
        <meshStandardMaterial {...paleStone} />
      </mesh>
      <mesh position={[0, 1.055, 0]} castShadow>
        <cylinderGeometry args={[0.46, 0.34, 0.11, 28]} />
        <meshStandardMaterial {...paleStone} />
      </mesh>
      <mesh position={[0, 1.125, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.44, 0.035, 8, 28]} />
        <meshStandardMaterial {...paleStone} />
      </mesh>
      <mesh position={[0, 0.77, 0]}>
        <cylinderGeometry args={[0.43, 0.47, 0.64, detailed ? 32 : 20, 1, true]} />
        <meshPhysicalMaterial
          ref={cascade}
          color='#88bab2'
          transparent
          opacity={0.4}
          roughness={0.1}
          clearcoat={0.9}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      {Array.from({ length: detailed ? 2 : 1 }).map((_, index) => (
        <mesh
          key={index}
          ref={(mesh: Mesh | null) => {
            cascadePulses.current[index] = mesh;
          }}
          position={[0, 0.9, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.46, 0.016, 6, 32]} />
          <meshBasicMaterial
            color='#c6e0da'
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.055, 0.07, 0.18, 10]} />
        <meshStandardMaterial {...agedBronze} />
      </mesh>
      <FountainSpray detailed={detailed} reducedMotion={reducedMotion} />

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
          {[-0.96, 0.96].map((z) => (
            <Box
              key={z}
              castShadow
              surface={agedBronze}
              position={[0, 0, z]}
              scale={[0.1, 2.56, 0.1]}
            />
          ))}
          {[-1.22, 0, 1.22].map((y) => (
            <Box
              key={y}
              castShadow
              surface={agedBronze}
              position={[0, y, 0]}
              scale={[0.1, 0.1, 2.02]}
            />
          ))}
          {[-0.64, -0.32, 0, 0.32, 0.64].map((z) => (
            <Box
              key={z}
              castShadow
              surface={{ color: '#766c50', roughness: 0.56, metalness: 0.45 }}
              position={[-0.01, 0, z]}
              scale={[0.065, 2.34, 0.045]}
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

      <Box
        surface={{ color: '#817968', roughness: 0.98, metalness: 0 }}
        position={[7.5, -0.12, 0]}
        scale={[5, 0.24, 5.4]}
      />
      {[-2.18, 2.18].map((z) => (
        <group key={z}>
          <Box
            surface={{ color: '#4f493c', roughness: 1, metalness: 0 }}
            position={[7.25, 0.04, z]}
            scale={[4.2, 0.26, 0.68]}
          />
          {detailed &&
            [6.15, 7.35, 8.55].map((x, index) => (
              <mesh
                key={x}
                position={[x, 0.3 + index * 0.025, z]}
                scale={[0.38, 0.25 + index * 0.035, 0.32]}
                castShadow
              >
                <sphereGeometry args={[1, 14, 9]} />
                <meshStandardMaterial
                  color={index % 2 === 0 ? '#496649' : '#38553c'}
                  roughness={0.98}
                />
              </mesh>
            ))}
        </group>
      ))}
      {[5.9, 7.15, 8.4, 9.65].map((x, index) => (
        <mesh key={x} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.015, 0]}>
          <planeGeometry args={[1.12, 2.65]} />
          <meshStandardMaterial color={index % 2 === 0 ? '#b8aa90' : '#aea187'} roughness={0.98} />
        </mesh>
      ))}
    </>
  );
}

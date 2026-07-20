import { useAtomValue } from '@effect/atom-react';
import type { ThreeEvent } from '@react-three/fiber/webgpu';
import {
  watchProgramStreamAtom,
  watchViewAtom,
  type WatchControlCommand,
} from '@tether/client-runtime/modules/watch-along';
import { useRef, useState } from 'react';
import type { Mesh } from 'three';

import { useRoomExperience } from '../components/room-experience-context';
import type { RoomTemplate } from '../templates/registry';
import { useConsoleFocus } from './console-focus-context';
import { MeshLabel } from './mesh-label';
import { consoleControlsForView, seekFractionFromPointer } from './watch-console-model';
import type { WatchSeekRequest } from './watch-display';

const TRACK_WIDTH = 3.8;

function HardwareButton({
  label,
  position,
  accent = false,
  enabled,
  onPress,
}: {
  readonly label: string;
  readonly position: readonly [number, number, number];
  readonly accent?: boolean;
  readonly enabled: boolean;
  readonly onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const y = position[1] - (pressed ? 0.035 : 0);
  return (
    <group position={[position[0], y, position[2]]}>
      <mesh
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          if (enabled) onPress();
        }}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          if (enabled) setPressed(true);
        }}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setPressed(false);
        }}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => {
          setHovered(false);
          setPressed(false);
        }}
      >
        <boxGeometry args={[0.68, 0.14, 0.5]} />
        <meshStandardMaterial
          color={!enabled ? '#24252a' : accent || hovered ? '#d94f20' : '#3a3b40'}
          emissive={enabled && (accent || hovered) ? '#6a1f0d' : '#000000'}
          emissiveIntensity={0.45}
          metalness={0.45}
          roughness={0.42}
        />
      </mesh>
      <MeshLabel
        color={enabled ? '#f4f1ea' : '#777982'}
        position={[0, 0.081, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        width={0.52}
        height={0.13}
      >
        {label}
      </MeshLabel>
    </group>
  );
}

export function WatchConsole({
  capability,
  onSelect,
  onSeekRequested,
  error,
}: {
  readonly capability: NonNullable<RoomTemplate['watchAlong']>;
  readonly onSelect: () => void;
  readonly onSeekRequested: (request: Omit<WatchSeekRequest, 'sequence'>) => void;
  readonly error: string | null;
}) {
  const { binding } = useRoomExperience();
  const stream = useAtomValue(watchProgramStreamAtom);
  const view = useAtomValue(watchViewAtom);
  const focus = useConsoleFocus();
  const controls = consoleControlsForView(view);
  const [preview, setPreview] = useState<number | null>(null);
  const track = useRef<Mesh>(null);
  const dragging = useRef(false);
  const shownProgress = preview ?? view.progress;

  const dispatch = (control: WatchControlCommand) => {
    if (focus.focused) binding.controller.watch.control(control);
  };
  const enterFocus = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    focus.dispatch({ _tag: 'Enter' });
  };
  const seekFromEvent = (event: ThreeEvent<PointerEvent>) => {
    const mesh = track.current;
    if (mesh === null) return shownProgress;
    return seekFractionFromPointer(mesh.worldToLocal(event.point.clone()).x, TRACK_WIDTH);
  };
  const primaryCommand = () => {
    switch (controls.primary.kind) {
      case 'play':
        dispatch({ kind: 'play' });
        return;
      case 'pause':
        dispatch({ kind: 'pause' });
        return;
      case 'replay':
        dispatch({ kind: 'replay' });
        return;
      case null:
        return;
    }
  };

  return (
    <>
      <group position={capability.console.position}>
        <mesh position={[0, 0.39, 0.1]} onClick={enterFocus}>
          <boxGeometry args={[5.1, 0.16, 0.9]} />
          <meshStandardMaterial color='#202126' metalness={0.55} roughness={0.38} />
        </mesh>
        {focus.inRange && !focus.focused && (
          <MeshLabel color='#f48346' position={[0, 0.92, 0.32]} width={2.5} height={0.3}>
            ENTER · USE CONSOLE
          </MeshLabel>
        )}
        {focus.focused && (
          <MeshLabel color='#aeb1ba' position={[0, 0.92, 0.32]} width={2.5} height={0.3}>
            ENTER · EXIT FOCUS
          </MeshLabel>
        )}
        <MeshLabel
          color='#aeb1ba'
          position={[0, 0.62, 0.03]}
          rotation={[-Math.PI / 2, 0, 0]}
          width={2.8}
          height={0.22}
        >
          {(error ?? controls.feedback).toUpperCase()}
        </MeshLabel>
        {controls.select.visible && (
          <HardwareButton
            label='SELECT'
            position={[-1.95, 0.51, 0.14]}
            enabled={focus.focused && controls.select.enabled}
            accent
            onPress={onSelect}
          />
        )}
        {controls.primary.kind !== null && (
          <HardwareButton
            label={controls.primary.kind.toUpperCase()}
            position={[-1.95, 0.51, 0.14]}
            enabled={focus.focused && controls.primary.enabled}
            accent={controls.primary.kind === 'play' || controls.primary.kind === 'replay'}
            onPress={primaryCommand}
          />
        )}
        {controls.seek.visible && (
          <group position={[0.15, 0.53, 0.14]}>
            <mesh
              ref={track}
              onPointerDown={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                if (!focus.focused || !controls.seek.enabled) return;
                dragging.current = true;
                (event.nativeEvent.target as Element).setPointerCapture(event.pointerId);
                setPreview(seekFromEvent(event));
              }}
              onPointerMove={(event: ThreeEvent<PointerEvent>) => {
                if (!dragging.current) return;
                event.stopPropagation();
                setPreview(seekFromEvent(event));
              }}
              onPointerUp={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                if (!dragging.current) return;
                dragging.current = false;
                (event.nativeEvent.target as Element).releasePointerCapture(event.pointerId);
                const target = seekFromEvent(event);
                setPreview(null);
                if (!focus.focused || stream === null) return;
                onSeekRequested({ baseRevision: view.revision, target, stream });
                binding.controller.watch.control({ kind: 'seek', target });
              }}
              onPointerOver={(event: ThreeEvent<PointerEvent>) => event.stopPropagation()}
            >
              <boxGeometry args={[TRACK_WIDTH, 0.08, 0.2]} />
              <meshStandardMaterial color='#111318' metalness={0.35} roughness={0.55} />
            </mesh>
            <mesh position={[(shownProgress - 0.5) * TRACK_WIDTH, 0.1, 0]}>
              <cylinderGeometry args={[0.11, 0.11, 0.14, 20]} />
              <meshStandardMaterial color='#e55b26' metalness={0.45} roughness={0.35} />
            </mesh>
          </group>
        )}
        {controls.eject.visible && (
          <HardwareButton
            label='EJECT'
            position={[2.05, 0.51, 0.14]}
            enabled={focus.focused && controls.eject.enabled}
            onPress={() => dispatch({ kind: 'eject' })}
          />
        )}
      </group>
      {view.role !== null && !focus.focused && !focus.inRange && (
        <MeshLabel
          color='#bdc0c9'
          position={[
            capability.display.position[0],
            capability.display.position[1] - capability.display.size[1] / 2 - 0.24,
            capability.display.position[2] + 0.02,
          ]}
          width={3.5}
          height={0.3}
        >
          VIDEO READY · APPROACH CONSOLE
        </MeshLabel>
      )}
    </>
  );
}

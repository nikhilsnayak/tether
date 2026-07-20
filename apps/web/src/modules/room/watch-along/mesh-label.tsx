import { useEffect, useState } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

export function MeshLabel({
  children,
  color,
  position,
  rotation,
  width,
  height,
}: {
  readonly children: string;
  readonly color: string;
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly width: number;
  readonly height: number;
}) {
  const [label] = useState(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1_024;
    canvas.height = 256;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return { canvas, texture };
  });

  useEffect(() => {
    const context = label.canvas.getContext('2d');
    if (context === null) return;
    context.clearRect(0, 0, label.canvas.width, label.canvas.height);
    context.fillStyle = color;
    context.font = '600 64px "Space Mono", monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(children, label.canvas.width / 2, label.canvas.height / 2);
    label.texture.needsUpdate = true;
  }, [children, color, label]);

  useEffect(
    () => () => {
      label.texture.dispose();
      label.canvas.width = 0;
      label.canvas.height = 0;
    },
    [label],
  );

  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={label.texture} transparent toneMapped={false} />
    </mesh>
  );
}

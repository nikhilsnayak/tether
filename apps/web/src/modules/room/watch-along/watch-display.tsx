import { useAtomValue } from '@effect/atom-react';
import { useVideoTexture } from '@react-three/drei';
import { watchProgramStreamAtom, watchViewAtom } from '@tether/client-runtime/modules/watch-along';
import { Suspense } from 'react';

import type { RoomTemplate } from '../templates/registry';

function VideoMaterial({
  stream,
  muted,
}: {
  readonly stream: MediaStream;
  readonly muted: boolean;
}) {
  const texture = useVideoTexture(stream, { muted, loop: false });
  return <meshBasicMaterial map={texture} toneMapped={false} />;
}

export function WatchDisplay({
  capability,
}: {
  readonly capability: NonNullable<RoomTemplate['watchAlong']>;
}) {
  const stream = useAtomValue(watchProgramStreamAtom);
  const view = useAtomValue(watchViewAtom);

  return (
    <group position={capability.display.position}>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[...capability.display.size]} />
        {stream === null ? (
          <meshBasicMaterial color='#080a0f' toneMapped={false} />
        ) : (
          <Suspense fallback={<meshBasicMaterial color='#080a0f' toneMapped={false} />}>
            <VideoMaterial stream={stream.value as MediaStream} muted={view.role === 'presenter'} />
          </Suspense>
        )}
      </mesh>
    </group>
  );
}

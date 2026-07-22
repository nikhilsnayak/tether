import { useAtomValue } from '@effect/atom-react';
import { useVideoTexture } from '@react-three/drei';
import { watchProgramStreamAtom } from '@tether/client-runtime/modules/watch-along';
import { Suspense } from 'react';

import type { RoomTemplate } from '../templates/registry';
import { programMediaStreamValue } from './platform';

function VideoMaterial({ stream }: { readonly stream: MediaStream }) {
  const texture = useVideoTexture(stream, { muted: true, loop: false });
  return <meshBasicMaterial map={texture} toneMapped={false} />;
}

export function WatchDisplay({
  capability,
}: {
  readonly capability: NonNullable<RoomTemplate['watchAlong']>;
}) {
  const stream = useAtomValue(watchProgramStreamAtom);

  return (
    <group position={capability.display.position}>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[...capability.display.size]} />
        {stream === null ? (
          <meshBasicMaterial color='#080a0f' toneMapped={false} />
        ) : (
          <Suspense fallback={<meshBasicMaterial color='#080a0f' toneMapped={false} />}>
            <VideoMaterial stream={programMediaStreamValue(stream)} />
          </Suspense>
        )}
      </mesh>
    </group>
  );
}

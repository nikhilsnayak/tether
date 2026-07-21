import { useAtomValue } from '@effect/atom-react';
import { watchProgramStreamAtom, watchViewAtom } from '@tether/client-runtime/modules/watch-along';
import { useEffect, useState } from 'react';
import { SRGBColorSpace, VideoTexture } from 'three';

import type { RoomTemplate } from '../templates/registry';

function SharedVideo({
  stream,
  muted,
  size,
}: {
  readonly stream: MediaStream;
  readonly muted: boolean;
  readonly size: readonly [number, number];
}) {
  const [video] = useState(() => {
    const element = document.createElement('video');
    element.autoplay = true;
    element.playsInline = true;
    return element;
  });
  const [texture] = useState(() => {
    const created = new VideoTexture(video);
    created.colorSpace = SRGBColorSpace;
    return created;
  });

  useEffect(() => {
    video.muted = muted;
    video.srcObject = stream;
    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [muted, stream, video]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={[0, 0, 0.006]}>
      <planeGeometry args={[...size]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
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
      {stream === null ? (
        <mesh position={[0, 0, 0.006]}>
          <planeGeometry args={[...capability.display.size]} />
          <meshBasicMaterial color='#080a0f' toneMapped={false} />
        </mesh>
      ) : (
        <SharedVideo
          stream={stream.value as MediaStream}
          muted={view.role === 'presenter'}
          size={capability.display.size}
        />
      )}
    </group>
  );
}

import { useAtomValue } from '@effect/atom-react';
import {
  watchProgramStreamAtom,
  watchViewAtom,
  type ProgramStreamHandle,
  type WatchSessionView,
} from '@tether/client-runtime/modules/watch-along';
import { Effect } from 'effect';
import { useEffect, useEffectEvent, useState } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

import type { RoomTemplate } from '../templates/registry';
import { MeshLabel } from './mesh-label';
import { containVideoSize, createReceiverFrameCache } from './receiver-frame-cache';
import type { WatchRendererHealth } from './renderer-health';

export interface WatchSeekRequest {
  readonly baseRevision: number;
  readonly target: number;
  readonly stream: ProgramStreamHandle;
}

const displayTreatment = (view: WatchSessionView): string | null => {
  if (view.status === 'buffering' && view.bufferingReason === 'background-throttled') {
    return 'Waiting for presenter';
  }
  if (
    view.status === 'preparing-local' ||
    view.status === 'awaiting-remote-start' ||
    view.status === 'loaded-paused'
  ) {
    return 'Loaded';
  }
  if (view.status === 'awaiting-recovery-snapshot') return 'Interrupted';
  return null;
};

function runFrameCache<E>(
  operation: Effect.Effect<boolean, E>,
  health: WatchRendererHealth,
  active: boolean,
): boolean {
  return Effect.runSync(
    operation.pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          health.fail('frame-draw', active);
          return false;
        }),
      ),
    ),
  );
}

function WatchVideoSurface({
  stream,
  view,
  size,
  seekRequest,
  health,
}: {
  readonly stream: MediaStream;
  readonly view: WatchSessionView;
  readonly size: readonly [number, number];
  readonly seekRequest: WatchSeekRequest | null;
  readonly health: WatchRendererHealth;
}) {
  const [cache] = useState(createReceiverFrameCache);
  const [texture] = useState(() => {
    const value = new CanvasTexture(cache.canvas);
    value.colorSpace = SRGBColorSpace;
    return value;
  });
  const [frameSize, setFrameSize] = useState<readonly [number, number] | null>(null);

  const captureFrame = useEffectEvent(
    (video: HTMLVideoElement, metadata: VideoFrameCallbackMetadata) => {
      if (!runFrameCache(cache.capture(video, metadata, view), health, view.role !== null)) return;
      setFrameSize([cache.canvas.width, cache.canvas.height]);
      texture.needsUpdate = true;
    },
  );
  const armSeek = useEffectEvent((request: WatchSeekRequest) => {
    cache.armSeek(request.baseRevision, request.target, view);
  });
  const failVideo = useEffectEvent(() => {
    health.fail('video-error', view.role !== null);
  });

  useEffect(() => {
    if (seekRequest === null) return;
    armSeek(seekRequest);
  }, [seekRequest]);

  useEffect(() => {
    if (runFrameCache(cache.acceptView(view), health, view.role !== null)) {
      texture.needsUpdate = true;
    }
  }, [cache, health, texture, view]);

  useEffect(() => {
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.addEventListener('error', failVideo);
    let frameCallback = 0;
    const receiveFrame: VideoFrameRequestCallback = (_now, metadata) => {
      captureFrame(video, metadata);
      frameCallback = video.requestVideoFrameCallback(receiveFrame);
    };
    frameCallback = video.requestVideoFrameCallback(receiveFrame);
    void video.play().catch(failVideo);

    return () => {
      video.cancelVideoFrameCallback(frameCallback);
      video.removeEventListener('error', failVideo);
      video.pause();
      video.srcObject = null;
      texture.dispose();
      cache.dispose();
    };
  }, [cache, health, stream, texture]);

  const planeSize = frameSize === null ? size : containVideoSize(frameSize, size);
  const treatment = frameSize === null ? displayTreatment(view) : null;

  return (
    <>
      <mesh position={[0, 0, 0.006]}>
        <planeGeometry args={[planeSize[0], planeSize[1]]} />
        {frameSize === null ? (
          <meshBasicMaterial color='#151820' toneMapped={false} />
        ) : (
          <meshBasicMaterial map={texture} toneMapped={false} />
        )}
      </mesh>
      {treatment !== null && (
        <MeshLabel color='#b7bbc8' position={[0, 0, 0.02]} width={3.4} height={0.42}>
          {treatment}
        </MeshLabel>
      )}
    </>
  );
}

export function WatchDisplay({
  capability,
  seekRequest,
  health,
}: {
  readonly capability: NonNullable<RoomTemplate['watchAlong']>;
  readonly seekRequest: WatchSeekRequest | null;
  readonly health: WatchRendererHealth;
}) {
  const streamHandle = useAtomValue(watchProgramStreamAtom);
  const view = useAtomValue(watchViewAtom);
  const stream = streamHandle === null ? null : (streamHandle.value as MediaStream);
  const activeSeekRequest = seekRequest?.stream === streamHandle ? seekRequest : null;
  const treatment = displayTreatment(view);

  return (
    <group position={capability.display.position}>
      {stream === null ? (
        treatment === null ? null : (
          <>
            <mesh position={[0, 0, 0.006]}>
              <planeGeometry args={[...capability.display.size]} />
              <meshBasicMaterial color='#151820' toneMapped={false} />
            </mesh>
            <MeshLabel color='#b7bbc8' position={[0, 0, 0.02]} width={3.4} height={0.42}>
              {treatment}
            </MeshLabel>
          </>
        )
      ) : (
        <WatchVideoSurface
          key={stream.id}
          stream={stream}
          view={view}
          size={capability.display.size}
          seekRequest={activeSeekRequest}
          health={health}
        />
      )}
    </group>
  );
}

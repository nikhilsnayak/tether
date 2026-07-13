import { Avatar, AvatarFallback } from '@tether/ui/components/avatar';
import { cn } from '@tether/ui/lib/utils';
import { motion, animate, useMotionValue } from 'motion/react';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';

import { usePinnedDraggableTile, type TileCorner } from '../hooks/use-pinned-draggable-tile';

function attachMediaStreamVideo(video: HTMLVideoElement | null, stream: MediaStream | null) {
  if (video === null) return;
  video.srcObject = stream;
}

const TILE_MARGIN = 16;
const TILE_SNAP = { type: 'spring', stiffness: 500, damping: 40 } as const;

export function DraggableSelfPreview({
  boundaryRef,
  aspectRatio,
  children,
}: {
  readonly boundaryRef: RefObject<HTMLDivElement | null>;
  readonly aspectRatio: number;
  readonly children: ReactNode;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const { cornerRef, cornerOffset } = usePinnedDraggableTile(tileRef, x, y, TILE_MARGIN);
  const snapToNearestCorner = () => {
    const tile = tileRef.current;
    const boundary = tile?.offsetParent as HTMLElement | null;
    if (tile === null || boundary === null) return;
    const stage = boundary.getBoundingClientRect();
    const rect = tile.getBoundingClientRect();
    const centerX = rect.left - stage.left + rect.width / 2;
    const centerY = rect.top - stage.top + rect.height / 2;
    const corner =
      `${centerY < stage.height / 2 ? 't' : 'b'}${centerX < stage.width / 2 ? 'l' : 'r'}` as TileCorner;
    cornerRef.current = corner;
    const offset = cornerOffset(corner);
    void animate(x, offset.x, TILE_SNAP);
    void animate(y, offset.y, TILE_SNAP);
  };
  return (
    <motion.div
      ref={tileRef}
      drag
      dragConstraints={boundaryRef}
      dragElastic={0.08}
      dragMomentum={false}
      onDragEnd={snapToNearestCorner}
      whileDrag={{ scale: 1.04 }}
      style={{ x, y, aspectRatio }}
      className='border-border bg-card absolute top-0 left-0 w-[clamp(7rem,30vw,9rem)] cursor-grab touch-none overflow-hidden rounded-md border shadow-lg active:cursor-grabbing landscape:w-[clamp(11rem,18vw,15rem)]'
    >
      {children}
    </motion.div>
  );
}

function initials(id: string) {
  return (
    id
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 2)
      .toUpperCase() || '··'
  );
}

export function SelfVideo({
  stream,
  cameraOn,
  selfId,
}: {
  readonly stream: MediaStream | null;
  readonly cameraOn: boolean;
  readonly selfId: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    attachMediaStreamVideo(videoRef.current, stream);
  }, [stream]);

  return (
    <>
      <video
        ref={videoRef}
        aria-label='Local video preview'
        autoPlay
        muted
        playsInline
        className={cn('size-full -scale-x-100 object-cover', !cameraOn && 'invisible')}
      />
      {!cameraOn && (
        <div className='bg-card absolute inset-0 flex items-center justify-center'>
          <Avatar>
            <AvatarFallback>{initials(selfId)}</AvatarFallback>
          </Avatar>
        </div>
      )}
      <span className='bg-background/50 absolute bottom-1 left-2 rounded px-1.5 py-0.5 font-mono text-[10px] tracking-[0.15em] uppercase'>
        You
      </span>
    </>
  );
}

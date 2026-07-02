import { useAtomValue } from '@effect/atom-react';
import type { PeerSessionView, RoomSession } from '@tether/client-runtime/modules/room';
import { Avatar, AvatarFallback } from '@tether/ui/components/avatar';
import { Badge } from '@tether/ui/components/badge';
import { Button } from '@tether/ui/components/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@tether/ui/components/drawer';
import { Input } from '@tether/ui/components/input';
import { ScrollArea } from '@tether/ui/components/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tether/ui/components/tooltip';
import { cn } from '@tether/ui/lib/utils';
import {
  AlertTriangle,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  SendHorizontal,
  User,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { motion, useMotionValue, animate } from 'motion/react';
import {
  type ReactNode,
  type RefObject,
  type SubmitEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { Wordmark } from '@/components/logo';
import { useViewportAspectRatio } from '@/hooks/use-viewport-aspect-ratio';

import { usePeerConnection } from '../hooks/use-peer-connection';
import {
  peerLocalStreamAtom,
  peerRemoteStreamAtom,
  peerSessionViewAtom,
} from '../peer-session/view';

function PeerSessionStatusScreen({
  indicatorClassName,
  pillLabel,
  icon,
  iconClassName,
  label,
  hint,
  action,
}: {
  readonly indicatorClassName: string;
  readonly pillLabel: string;
  readonly icon: ReactNode;
  readonly iconClassName?: string;
  readonly label: string;
  readonly hint: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className='relative z-40 grid content-center justify-items-center gap-6 px-6 text-center'>
      <div className='absolute top-4 left-4 flex items-center gap-3'>
        <Wordmark />
        <div className='border-border flex items-center gap-2 border-l pl-3'>
          <span className={cn('size-2 rounded-full', indicatorClassName)} />
          <span className='text-xs font-medium'>{pillLabel}</span>
        </div>
      </div>

      <div className='grid justify-items-center gap-4'>
        <Avatar size='lg'>
          <AvatarFallback className={iconClassName}>{icon}</AvatarFallback>
        </Avatar>
        <div className='space-y-1'>
          <p className='text-lg font-medium'>{label}</p>
          <p className='text-muted-foreground max-w-sm text-sm'>{hint}</p>
        </div>
      </div>

      {action}
    </div>
  );
}

export function PeerSessionLoading() {
  return (
    <PeerSessionStatusScreen
      indicatorClassName='animate-pulse bg-warning'
      pillLabel='Starting'
      icon={<LoaderCircle className='size-9 animate-spin' />}
      label='Starting peer session…'
      hint='Setting up your connection.'
    />
  );
}

export function PeerSessionError({
  error,
  reset,
}: {
  readonly error: unknown;
  readonly reset: () => void;
}) {
  const message = error instanceof Error ? error.message : 'Unknown peer-session failure';

  return (
    <PeerSessionStatusScreen
      indicatorClassName='bg-destructive'
      pillLabel='Failed'
      icon={<AlertTriangle className='size-9' />}
      iconClassName='bg-destructive/15 text-destructive'
      label='Peer session failed'
      hint={message}
      action={
        <Button variant='secondary' onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}

const ERROR_STATUSES = new Set<PeerSessionView['status']>([
  'room-full',
  'peer-already-joined',
  'disconnected',
  'failed',
]);

function peerSessionStatusPresentation(status: PeerSessionView['status']): {
  readonly indicatorClassName: string;
  readonly label: string;
  readonly hint: string;
} {
  switch (status) {
    case 'connecting':
      return {
        indicatorClassName: 'animate-pulse bg-warning',
        label: 'Connecting',
        hint: 'Establishing a secure connection…',
      };
    case 'connected':
      return {
        indicatorClassName: 'bg-success',
        label: 'Connected',
        hint: 'You are connected.',
      };
    case 'reconnecting':
      return {
        indicatorClassName: 'animate-pulse bg-warning',
        label: 'Reconnecting',
        hint: 'Connection interrupted — trying to recover…',
      };
    case 'transport-lost':
      return {
        indicatorClassName: 'bg-warning',
        label: 'Peer transport lost',
        hint: 'The connection dropped. Waiting to recover, or leave to retry.',
      };
    case 'waiting-for-peer':
      return {
        indicatorClassName: 'animate-pulse bg-warning',
        label: 'Waiting for peer',
        hint: 'Share this room to invite someone.',
      };
    case 'negotiation-stalled':
      return {
        indicatorClassName: 'bg-warning',
        label: 'Taking longer than expected',
        hint: 'Still connecting. You can leave and retry.',
      };
    case 'disconnected':
      return {
        indicatorClassName: 'bg-muted-foreground',
        label: 'Signaling disconnected',
        hint: 'The signaling connection was lost.',
      };
    case 'failed':
      return {
        indicatorClassName: 'bg-destructive',
        label: 'Session failed',
        hint: 'Something went wrong with the connection.',
      };
    case 'room-full':
      return {
        indicatorClassName: 'bg-destructive',
        label: 'Room is full',
        hint: 'This room already has two people.',
      };
    case 'peer-already-joined':
      return {
        indicatorClassName: 'bg-destructive',
        label: 'Already joined',
        hint: 'This identity is already active in the room.',
      };
  }
}

function initials(id: string) {
  return (
    id
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 2)
      .toUpperCase() || '··'
  );
}

export function RoomSessionScreen({
  onLeaveRoom,
  session,
}: {
  readonly onLeaveRoom: () => void;
  readonly session: RoomSession;
}) {
  const { leave, sendMessage } = usePeerConnection({
    input: { roomId: session.roomId, selfId: session.selfId },
  });
  const view = useAtomValue(peerSessionViewAtom);
  const localStream = useAtomValue(peerLocalStreamAtom);
  const remoteStream = useAtomValue(peerRemoteStreamAtom);
  const [draft, setDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const deviceAspectRatio = useViewportAspectRatio();
  const stageRef = useRef<HTMLDivElement>(null);
  const [readCount, setReadCount] = useState(view.messages.length);
  const messageCount = view.messages.length;
  const hasUnread = !chatOpen && messageCount > readCount;

  const presentation = peerSessionStatusPresentation(view.status);
  const isConnected = view.status === 'connected';
  const handleLeave = () => {
    void leave().then(onLeaveRoom, onLeaveRoom);
  };
  const handleMicToggle = () => {
    const enabled = !micOn;

    for (const track of localStream?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }

    setMicOn(enabled);
  };
  const handleCameraToggle = () => {
    const enabled = !camOn;

    for (const track of localStream?.getVideoTracks() ?? []) {
      track.enabled = enabled;
    }

    setCamOn(enabled);
  };

  if (ERROR_STATUSES.has(view.status)) {
    return (
      <PeerSessionStatusScreen
        indicatorClassName={presentation.indicatorClassName}
        pillLabel={presentation.label}
        icon={<AlertTriangle className='size-9' />}
        iconClassName='bg-destructive/15 text-destructive'
        label={presentation.label}
        hint={presentation.hint}
        action={
          <Button variant='secondary' onClick={onLeaveRoom}>
            Back to room setup
          </Button>
        }
      />
    );
  }

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const message = draft.trim();
    if (message.length === 0 || !isConnected) {
      return;
    }
    if (sendMessage(message)) {
      setDraft('');
    }
  };

  return (
    <TooltipProvider delay={200}>
      <div className='relative z-40 grid grid-rows-[1fr_auto]'>
        <div ref={stageRef} className='relative flex items-center justify-center overflow-hidden'>
          {remoteStream ? (
            <RemoteVideoTile stream={remoteStream} />
          ) : (
            <div className='grid justify-items-center gap-4 px-6 text-center'>
              <Avatar size='lg'>
                <AvatarFallback>
                  <User className='size-10' />
                </AvatarFallback>
              </Avatar>
              <div className='space-y-1'>
                <p className='text-lg font-medium'>{presentation.label}</p>
                <p className='text-muted-foreground text-sm'>{presentation.hint}</p>
              </div>
            </div>
          )}

          <div className='absolute inset-x-0 top-0 flex items-center justify-between bg-linear-to-b from-black/60 to-transparent p-4 pb-10'>
            <div className='flex items-center gap-3'>
              <Wordmark className='drop-shadow-md' />
              <div className='border-border bg-background/70 flex items-center gap-2 rounded-md border px-3 py-1.5 backdrop-blur-sm'>
                <span className={cn('size-2 rounded-full', presentation.indicatorClassName)} />
                <span className='text-xs font-medium'>{presentation.label}</span>
              </div>
            </div>
            <Badge variant='secondary'>Room {session.roomId}</Badge>
          </div>

          <SelfVideoTile boundaryRef={stageRef} aspectRatio={deviceAspectRatio}>
            <LocalVideoTile localStream={localStream} camOn={camOn} selfId={session.selfId} />
          </SelfVideoTile>
        </div>

        <div className='border-border flex items-center justify-center gap-3 border-t p-4'>
          <ControlButton
            label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            tone={micOn ? 'neutral' : 'danger'}
            onClick={handleMicToggle}
          >
            {micOn ? <Mic /> : <MicOff />}
          </ControlButton>
          <ControlButton
            label={camOn ? 'Turn camera off' : 'Turn camera on'}
            tone={camOn ? 'neutral' : 'danger'}
            onClick={handleCameraToggle}
          >
            {camOn ? <Video /> : <VideoOff />}
          </ControlButton>
          <ControlButton label='Leave call' tone='danger' onClick={handleLeave}>
            <PhoneOff />
          </ControlButton>
          <ControlButton
            label={hasUnread ? 'Open chat (unread messages)' : 'Open chat'}
            tone='neutral'
            indicator={hasUnread}
            onClick={() => setChatOpen(true)}
          >
            <MessageSquare />
          </ControlButton>
        </div>
      </div>

      <Drawer
        direction={deviceAspectRatio < 1 ? 'bottom' : 'right'}
        open={chatOpen}
        onOpenChange={(open) => {
          setChatOpen(open);
          if (!open) {
            setReadCount(messageCount);
          }
        }}
      >
        <DrawerContent>
          <DrawerHeader className='relative border-b pr-14'>
            <DrawerTitle>Chat</DrawerTitle>
            <DrawerDescription>Messages are sent over the peer data channel.</DrawerDescription>
            <DrawerClose
              render={
                <Button
                  aria-label='Close chat'
                  variant='ghost'
                  size='icon-sm'
                  className='absolute top-3 right-3'
                />
              }
            >
              <X />
            </DrawerClose>
          </DrawerHeader>

          <ScrollArea className='flex-1'>
            <div className='p-4'>
              {view.messages.length === 0 ? (
                <p className='text-muted-foreground mt-8 text-center text-sm'>
                  No messages yet. Say hello once you are connected.
                </p>
              ) : (
                <ol className='space-y-3' aria-label='Chat messages'>
                  {view.messages.map((message) => (
                    <li
                      key={message.id}
                      className={cn(
                        'flex',
                        message.sender === 'self' ? 'justify-end' : 'justify-start',
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl px-4 py-2 text-sm',
                          message.sender === 'self'
                            ? 'rounded-br-md bg-primary text-primary-foreground'
                            : 'rounded-bl-md bg-muted text-foreground',
                        )}
                      >
                        <p className='wrap-break-word whitespace-pre-wrap'>{message.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </ScrollArea>

          <form className='flex gap-2 border-t p-4' onSubmit={handleSubmit}>
            <Input
              aria-label='Message'
              disabled={!isConnected}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={isConnected ? 'Write a message' : 'Connect to chat…'}
              value={draft}
            />
            <Button
              aria-label='Send message'
              disabled={!isConnected || draft.trim().length === 0}
              size='icon'
              type='submit'
            >
              <SendHorizontal />
            </Button>
          </form>
        </DrawerContent>
      </Drawer>
    </TooltipProvider>
  );
}

/** Remote peer's camera + mic. Not muted (we want their audio) and not mirrored. */
function RemoteVideoTile({ stream }: { readonly stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    video.srcObject = stream;
  }, [stream]);

  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- live call has no captions
    <video
      ref={videoRef}
      aria-label='Remote video'
      autoPlay
      playsInline
      className='size-full max-w-5xl object-cover'
    />
  );
}

type TileCorner = 'tl' | 'tr' | 'bl' | 'br';

const TILE_MARGIN = 16;
const TILE_SNAP = { type: 'spring', stiffness: 500, damping: 40 } as const;

/** Self-preview that snaps to the nearest stage corner on release. */
function SelfVideoTile({
  boundaryRef,
  aspectRatio,
  children,
}: {
  readonly boundaryRef: RefObject<HTMLDivElement | null>;
  readonly aspectRatio: number;
  readonly children: ReactNode;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<TileCorner>('br');
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const cornerOffset = (corner: TileCorner) => {
    const tile = tileRef.current;
    // offsetParent, not boundaryRef: the ancestor ref isn't attached yet during the mount layout effect.
    const boundary = tile?.offsetParent as HTMLElement | null;
    if (tile === null || boundary === null) {
      return { x: 0, y: 0 };
    }
    const maxX = boundary.clientWidth - tile.offsetWidth - TILE_MARGIN;
    const maxY = boundary.clientHeight - tile.offsetHeight - TILE_MARGIN;
    return {
      x: corner === 'tl' || corner === 'bl' ? TILE_MARGIN : maxX,
      y: corner === 'tl' || corner === 'tr' ? TILE_MARGIN : maxY,
    };
  };

  const onResize = useEffectEvent(() => {
    const offset = cornerOffset(cornerRef.current);
    x.set(offset.x);
    y.set(offset.y);
  });

  useLayoutEffect(() => {
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const snapToNearestCorner = () => {
    const tile = tileRef.current;
    const boundary = tile?.offsetParent as HTMLElement | null;
    if (tile === null || boundary === null) {
      return;
    }
    const stage = boundary.getBoundingClientRect();
    const rect = tile.getBoundingClientRect();
    const centerX = rect.left - stage.left + rect.width / 2;
    const centerY = rect.top - stage.top + rect.height / 2;
    const corner = `${centerY < stage.height / 2 ? 't' : 'b'}${
      centerX < stage.width / 2 ? 'l' : 'r'
    }` as TileCorner;
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
      className='border-border bg-card absolute top-0 left-0 w-[clamp(7rem,30vw,9rem)] cursor-grab touch-none overflow-hidden rounded-md border shadow-lg active:cursor-grabbing landscape:w-[clamp(14rem,24vw,20rem)]'
    >
      {children}
    </motion.div>
  );
}

/** Self-preview of the local camera. The live stream stays out of React state. */
function LocalVideoTile({
  localStream,
  camOn,
  selfId,
}: {
  readonly localStream: MediaStream | null;
  readonly camOn: boolean;
  readonly selfId: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    video.srcObject = localStream;
  }, [localStream]);

  return (
    <>
      <video
        ref={videoRef}
        aria-label='Local video preview'
        autoPlay
        muted
        playsInline
        className={cn('size-full -scale-x-100 object-cover', !camOn && 'invisible')}
      />
      {!camOn && (
        <div className='bg-card absolute inset-0 flex items-center justify-center'>
          <Avatar>
            <AvatarFallback>{initials(selfId)}</AvatarFallback>
          </Avatar>
        </div>
      )}
      <span className='bg-background/50 absolute bottom-1 left-2 rounded px-1.5 py-0.5 text-[10px] font-medium'>
        You
      </span>
    </>
  );
}

function ControlButton({
  label,
  tone,
  onClick,
  indicator = false,
  children,
}: {
  readonly label: string;
  readonly tone: 'neutral' | 'danger';
  readonly onClick: () => void;
  readonly indicator?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            variant={tone === 'danger' ? 'destructive' : 'secondary'}
            size='icon-lg'
            onClick={onClick}
            className='relative'
          />
        }
      >
        {children}
        {indicator && (
          <span className='bg-primary ring-background absolute top-1 right-1 size-2.5 rounded-full ring-2' />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

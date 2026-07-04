import { useAtomValue } from '@effect/atom-react';
import {
  isPeerSessionErrorStatus,
  peerLocalStreamAtom,
  peerRemoteStreamAtom,
  peerSessionStatusPresentation,
  peerSessionViewAtom,
  type PeerSessionStatusPresentation,
  type RoomSession,
} from '@tether/client-runtime/modules/room';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tether/ui/components/dropdown-menu';
import { Input } from '@tether/ui/components/input';
import { ScrollArea } from '@tether/ui/components/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@tether/ui/components/tooltip';
import { cn } from '@tether/ui/lib/utils';
import {
  AlertTriangle,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  SendHorizontal,
  ShieldCheck,
  User,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { motion, useMotionValue, animate } from 'motion/react';
import { type ReactNode, type RefObject, type SubmitEvent, useRef, useState } from 'react';

import { LogoMark, Wordmark } from '@/components/logo';
import { useViewportAspectRatio } from '@/hooks/use-viewport-aspect-ratio';

import { useAudioOutputDevices } from '../hooks/use-audio-output-devices';
import { useChatAutoScroll } from '../hooks/use-chat-auto-scroll';
import { usePeerConnection } from '../hooks/use-peer-connection';
import { usePinnedDraggableTile, type TileCorner } from '../hooks/use-pinned-draggable-tile';
import { useScreenWakeLock } from '../hooks/use-screen-wake-lock';
import { mediaStreamValue } from '../peer-session/platform';

const INDICATOR_TONE_CLASS = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground',
} satisfies Record<PeerSessionStatusPresentation['tone'], string>;

const statusIndicatorClassName = (presentation: PeerSessionStatusPresentation) =>
  cn(INDICATOR_TONE_CLASS[presentation.tone], presentation.pulse && 'animate-pulse');

function CallStatusScreen({
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
      <div className='absolute top-4 right-4 left-4 flex items-center gap-3'>
        <Wordmark className='max-sm:hidden' />
        <LogoMark className='size-5 sm:hidden' />
        <div className='border-border flex min-w-0 items-center gap-2 border-l pl-3'>
          <span className={cn('size-2 shrink-0 rounded-full', indicatorClassName)} />
          <span className='truncate font-mono text-[11px] tracking-[0.15em] uppercase'>
            {pillLabel}
          </span>
        </div>
      </div>

      <div className='grid justify-items-center gap-5'>
        <div className={cn('border-border grid size-20 place-items-center border', iconClassName)}>
          {icon}
        </div>
        <div className='space-y-2'>
          <p className='font-mono text-sm tracking-[0.2em] uppercase'>{label}</p>
          <p className='text-muted-foreground max-w-sm text-sm'>{hint}</p>
        </div>
      </div>

      {action}
    </div>
  );
}

export function CallLoadingScreen() {
  return (
    <CallStatusScreen
      indicatorClassName='animate-pulse bg-warning'
      pillLabel='Starting'
      icon={<LoaderCircle className='size-9 animate-spin' />}
      label='Starting your call…'
      hint='Setting up your connection.'
    />
  );
}

export function CallErrorScreen({
  error,
  reset,
}: {
  readonly error: unknown;
  readonly reset: () => void;
}) {
  const message = error instanceof Error ? error.message : 'Unknown peer-session failure';

  return (
    <CallStatusScreen
      indicatorClassName='bg-destructive'
      pillLabel='Failed'
      icon={<AlertTriangle className='size-9' />}
      iconClassName='bg-destructive/15 text-destructive'
      label='Something went wrong'
      hint={message}
      action={
        <Button variant='secondary' onClick={reset}>
          Try again
        </Button>
      }
    />
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

export function CallScreen({
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
  const localStreamHandle = useAtomValue(peerLocalStreamAtom);
  const remoteStreamHandle = useAtomValue(peerRemoteStreamAtom);
  const localStream = localStreamHandle === null ? null : mediaStreamValue(localStreamHandle);
  const remoteStream = remoteStreamHandle === null ? null : mediaStreamValue(remoteStreamHandle);
  const [draft, setDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sinkId, setSinkId] = useState('');
  const [speakerOn, setSpeakerOn] = useState(true);
  const deviceAspectRatio = useViewportAspectRatio();
  const stageRef = useRef<HTMLDivElement>(null);
  const messageListEndRef = useRef<HTMLDivElement>(null);
  const [readCount, setReadCount] = useState(view.messages.length);
  // Compared against view.sas, so a new code (reconnect) is unconfirmed by construction.
  const [confirmedSas, setConfirmedSas] = useState<string | null>(null);
  const sasConfirmed = view.sas !== null && confirmedSas === view.sas;
  const messageCount = view.messages.length;
  const hasUnread = !chatOpen && messageCount > readCount;

  useScreenWakeLock();
  useChatAutoScroll(messageListEndRef, chatOpen, messageCount);
  const audioOutputs = useAudioOutputDevices(localStream);

  const handleAudioOutputChange = (value: string) => {
    if (value === SPEAKER_OFF) {
      setSpeakerOn(false);
      return;
    }
    setSpeakerOn(true);
    setSinkId(value);
  };

  const presentation = peerSessionStatusPresentation(view.status);
  const isConnected = view.status === 'connected';
  const canChat = isConnected && view.chatReady;
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

  if (isPeerSessionErrorStatus(view.status)) {
    return (
      <CallStatusScreen
        indicatorClassName={statusIndicatorClassName(presentation)}
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
    if (message.length === 0 || !canChat) {
      return;
    }
    if (sendMessage(message)) {
      setDraft('');
    }
  };

  return (
    <>
      <div className='relative z-40 grid h-svh grid-rows-[minmax(0,1fr)_auto]'>
        <div ref={stageRef} className='relative flex items-center justify-center overflow-hidden'>
          {remoteStream ? (
            <RemoteVideo stream={remoteStream} sinkId={sinkId} muted={!speakerOn} />
          ) : (
            <div className='grid justify-items-center gap-5 px-6 text-center'>
              <div className='border-border grid size-20 place-items-center border'>
                <User className='text-muted-foreground size-9' />
              </div>
              <div className='space-y-2'>
                <p className='font-mono text-sm tracking-[0.2em] uppercase'>{presentation.label}</p>
                <p className='text-muted-foreground text-sm'>{presentation.hint}</p>
              </div>
            </div>
          )}

          <div className='absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-linear-to-b from-black/60 to-transparent p-4 pb-10'>
            <div className='flex min-w-0 items-center gap-3'>
              <Wordmark className='drop-shadow-md max-sm:hidden' />
              <LogoMark className='size-5 shrink-0 drop-shadow-md sm:hidden' />
              <div
                aria-label={presentation.label}
                className='border-border bg-background/70 flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5 backdrop-blur-sm max-sm:px-2'
              >
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    statusIndicatorClassName(presentation),
                  )}
                />
                <span className='truncate font-mono text-[11px] tracking-[0.15em] uppercase max-sm:hidden'>
                  {presentation.label}
                </span>
              </div>
            </div>
            <div className='flex shrink-0 flex-col items-end gap-1.5'>
              <Badge variant='secondary' className='font-mono tracking-[0.15em] uppercase'>
                <span className='max-sm:hidden'>Room&nbsp;</span>
                {session.roomId}
              </Badge>
              {view.sas !== null && sasConfirmed && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge
                        variant='secondary'
                        className='gap-1.5 font-mono text-[10px] tracking-widest'
                        render={
                          <button
                            aria-label='Safety code'
                            type='button'
                            onClick={() => setConfirmedSas(null)}
                          />
                        }
                      />
                    }
                  >
                    <ShieldCheck className='size-3' />
                    <span className='max-sm:hidden'>{view.sas}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    You confirmed this code matches the other person&apos;s screen. Tap to review
                    it.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          <DraggableSelfPreview boundaryRef={stageRef} aspectRatio={deviceAspectRatio}>
            <SelfVideo stream={localStream} cameraOn={camOn} selfId={session.selfId} />
          </DraggableSelfPreview>

          {view.sas !== null && !sasConfirmed && (
            <div className='absolute inset-x-0 bottom-4 z-50 flex justify-center px-4'>
              <section
                aria-label='Safety check'
                className='border-border bg-background/85 max-w-sm space-y-3 rounded-md border p-4 backdrop-blur-sm'
              >
                <div className='flex items-center gap-2'>
                  <ShieldCheck className='size-4' />
                  <h2 className='font-mono text-xs tracking-[0.2em] uppercase'>Safety check</h2>
                </div>
                <p
                  aria-label='Safety code'
                  className='text-center font-mono text-lg tracking-widest'
                >
                  {view.sas}
                </p>
                <p className='text-muted-foreground text-sm'>
                  Read this code aloud to each other. It proves that no one, not even the server,
                  can see this call. Trust the call only if you both see the same code.
                </p>
                <div className='grid grid-cols-2 gap-2'>
                  <Button size='sm' variant='destructive' onClick={handleLeave}>
                    They don&apos;t match
                  </Button>
                  <Button size='sm' onClick={() => setConfirmedSas(view.sas)}>
                    We see the same code
                  </Button>
                </div>
              </section>
            </div>
          )}
        </div>

        <div className='border-border flex items-center justify-center gap-2 border-t p-4 sm:gap-3'>
          <CallControlButton
            label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            caption='mic'
            tone={micOn ? 'neutral' : 'danger'}
            onClick={handleMicToggle}
          >
            {micOn ? <Mic /> : <MicOff />}
          </CallControlButton>
          <CallControlButton
            label={camOn ? 'Turn camera off' : 'Turn camera on'}
            caption='cam'
            tone={camOn ? 'neutral' : 'danger'}
            onClick={handleCameraToggle}
          >
            {camOn ? <Video /> : <VideoOff />}
          </CallControlButton>
          <AudioOutputControl
            outputs={audioOutputs}
            sinkId={sinkId}
            speakerOn={speakerOn}
            onChange={handleAudioOutputChange}
          />
          <CallControlButton label='Leave call' caption='end' tone='danger' onClick={handleLeave}>
            <PhoneOff />
          </CallControlButton>
          <CallControlButton
            label={hasUnread ? 'Open chat (unread messages)' : 'Open chat'}
            caption='chat'
            tone='neutral'
            indicator={hasUnread}
            onClick={() => setChatOpen(true)}
          >
            <MessageSquare />
          </CallControlButton>
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
          <DrawerHeader className='relative shrink-0 border-b pr-14'>
            <DrawerTitle className='font-mono text-xs tracking-[0.2em] uppercase'>Chat</DrawerTitle>
            <DrawerDescription>
              Messages go straight to the other person and disappear when the call ends.
            </DrawerDescription>
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

          <ScrollArea className='min-h-0 flex-1'>
            <div className='min-h-full p-4'>
              {view.messages.length === 0 ? (
                <p className='text-muted-foreground mt-8 text-center text-sm'>
                  No messages yet. Say hello once you are connected.
                </p>
              ) : (
                <ol className='space-y-4' aria-label='Chat messages'>
                  {view.messages.map((message) => (
                    <li key={message.id} className='grid grid-cols-[3rem_1fr] gap-3'>
                      <span
                        className={cn(
                          'pt-0.5 text-right font-mono text-[10px] tracking-[0.15em] uppercase',
                          message.sender === 'self' ? 'text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {message.sender === 'self' ? 'you' : 'peer'}
                      </span>
                      <p className='border-border min-w-0 border-l pl-3 text-sm wrap-anywhere whitespace-pre-wrap'>
                        {message.text}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
              <div ref={messageListEndRef} aria-hidden />
            </div>
          </ScrollArea>

          <form className='flex shrink-0 gap-2 border-t p-4' onSubmit={handleSubmit}>
            <Input
              aria-label='Message'
              disabled={!canChat}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={canChat ? 'Write a message' : 'Chat is unavailable…'}
              value={draft}
            />
            <Button
              aria-label='Send message'
              disabled={!canChat || draft.trim().length === 0}
              size='icon'
              type='submit'
            >
              <SendHorizontal />
            </Button>
          </form>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function attachMediaStreamVideo(
  video: HTMLVideoElement | null,
  stream: MediaStream | null,
  sinkId = '',
) {
  if (video === null) {
    return;
  }

  video.srcObject = stream;
  if (sinkId !== '' && typeof video.setSinkId === 'function') {
    void video.setSinkId(sinkId).catch(() => {});
  }
}

function RemoteVideo({
  stream,
  sinkId,
  muted,
}: {
  readonly stream: MediaStream;
  readonly sinkId: string;
  readonly muted: boolean;
}) {
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- live call has no captions
    <video
      ref={(video) => attachMediaStreamVideo(video, stream, sinkId)}
      aria-label='Remote video'
      autoPlay
      muted={muted}
      playsInline
      className='size-full max-w-5xl object-cover'
    />
  );
}

const SPEAKER_OFF = '__off__';

function AudioOutputControl({
  outputs,
  sinkId,
  speakerOn,
  onChange,
}: {
  readonly outputs: readonly MediaDeviceInfo[];
  readonly sinkId: string;
  readonly speakerOn: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label='Audio output'
                  variant={speakerOn ? 'secondary' : 'destructive'}
                  className='h-14 w-14 flex-col gap-1.5 rounded-sm sm:w-16'
                />
              }
            />
          }
        >
          {speakerOn ? <Volume2 /> : <VolumeX />}
          <span className='font-mono text-[9px] tracking-[0.2em] uppercase'>out</span>
        </TooltipTrigger>
        <TooltipContent>Audio output</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side='top' align='center' className='max-w-(--available-width)'>
        <DropdownMenuRadioGroup
          value={speakerOn ? sinkId || 'default' : SPEAKER_OFF}
          onValueChange={onChange}
        >
          <DropdownMenuLabel>Audio output</DropdownMenuLabel>
          {outputs.map((device, index) => (
            <DropdownMenuRadioItem
              key={device.deviceId}
              value={device.deviceId || 'default'}
              className='whitespace-nowrap'
            >
              {device.label || `Speaker ${index + 1}`}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={SPEAKER_OFF}>Off</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TILE_MARGIN = 16;
const TILE_SNAP = { type: 'spring', stiffness: 500, damping: 40 } as const;

function DraggableSelfPreview({
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

function SelfVideo({
  stream,
  cameraOn,
  selfId,
}: {
  readonly stream: MediaStream | null;
  readonly cameraOn: boolean;
  readonly selfId: string;
}) {
  return (
    <>
      <video
        ref={(video) => attachMediaStreamVideo(video, stream)}
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

function CallControlButton({
  label,
  caption,
  tone,
  onClick,
  indicator = false,
  children,
}: {
  readonly label: string;
  readonly caption: string;
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
            onClick={onClick}
            className='relative h-14 w-14 flex-col gap-1.5 rounded-sm sm:w-16'
          />
        }
      >
        {children}
        <span className='font-mono text-[9px] tracking-[0.2em] uppercase'>{caption}</span>
        {indicator && (
          <span className='bg-primary ring-background absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2' />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

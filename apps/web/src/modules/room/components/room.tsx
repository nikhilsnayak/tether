import { useAtomValue } from '@effect/atom-react';
import type { PeerSessionView, RoomSession } from '@tether/client-runtime/modules/room';
import { Avatar, AvatarFallback } from '@tether/ui/components/avatar';
import { Badge } from '@tether/ui/components/badge';
import { Button } from '@tether/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@tether/ui/components/card';
import { Input } from '@tether/ui/components/input';
import { ScrollArea } from '@tether/ui/components/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@tether/ui/components/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tether/ui/components/tooltip';
import { cn } from '@tether/ui/lib/utils';
import {
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  SendHorizontal,
  User,
  Video,
  VideoOff,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import { usePeerConnection } from '../hooks/use-peer-connection';
import { peerLocalStreamAtom, peerSessionViewAtom } from '../peer-session/view';

export function PeerSessionLoading() {
  return <p className='text-muted-foreground text-sm'>Starting peer session…</p>;
}

export function PeerSessionError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Unknown peer-session failure';

  return (
    <Card className='border-destructive/40'>
      <CardHeader>
        <CardTitle className='text-destructive'>Peer session failed</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
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
        indicatorClassName: 'animate-pulse bg-amber-400',
        label: 'Connecting',
        hint: 'Establishing a secure connection…',
      };
    case 'connected':
      return {
        indicatorClassName: 'bg-emerald-500',
        label: 'Connected',
        hint: 'You are connected.',
      };
    case 'reconnecting':
      return {
        indicatorClassName: 'animate-pulse bg-amber-400',
        label: 'Reconnecting',
        hint: 'Connection interrupted — trying to recover…',
      };
    case 'transport-lost':
      return {
        indicatorClassName: 'bg-amber-500',
        label: 'Peer transport lost',
        hint: 'The connection dropped. Waiting to recover, or leave to retry.',
      };
    case 'waiting-for-peer':
      return {
        indicatorClassName: 'animate-pulse bg-amber-400',
        label: 'Waiting for peer',
        hint: 'Share this room to invite someone.',
      };
    case 'negotiation-stalled':
      return {
        indicatorClassName: 'bg-amber-500',
        label: 'Taking longer than expected',
        hint: 'Still connecting. You can leave and retry.',
      };
    case 'disconnected':
      return {
        indicatorClassName: 'bg-slate-400',
        label: 'Signaling disconnected',
        hint: 'The signaling connection was lost.',
      };
    case 'failed':
      return {
        indicatorClassName: 'bg-red-500',
        label: 'Session failed',
        hint: 'Something went wrong with the connection.',
      };
    case 'room-full':
      return {
        indicatorClassName: 'bg-red-500',
        label: 'Room is full',
        hint: 'This room already has two people.',
      };
    case 'peer-already-joined':
      return {
        indicatorClassName: 'bg-red-500',
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
  const { sendMessage } = usePeerConnection({
    input: { roomId: session.roomId, selfId: session.selfId },
  });
  const view = useAtomValue(peerSessionViewAtom);
  const localStream = useAtomValue(peerLocalStreamAtom);
  const [draft, setDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  useEffect(() => {
    for (const track of localStream?.getAudioTracks() ?? []) {
      track.enabled = micOn;
    }
  }, [localStream, micOn]);

  useEffect(() => {
    for (const track of localStream?.getVideoTracks() ?? []) {
      track.enabled = camOn;
    }
  }, [localStream, camOn]);

  const presentation = peerSessionStatusPresentation(view.status);
  const isConnected = view.status === 'connected';

  if (ERROR_STATUSES.has(view.status)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{presentation.label}</CardTitle>
          <CardDescription>{presentation.hint}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant='outline' onClick={onLeaveRoom}>
            Back to room setup
          </Button>
        </CardContent>
      </Card>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
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
      <div className='fixed inset-0 z-40 flex flex-col bg-neutral-950 text-neutral-50'>
        <div className='relative flex flex-1 items-center justify-center overflow-hidden'>
          {/* Remote peer stage — remote video is wired in the next chunk. */}
          <div className='flex flex-col items-center gap-4 px-6 text-center'>
            <Avatar size='lg' className='size-24'>
              <AvatarFallback className='bg-neutral-800 text-neutral-300'>
                <User className='size-10' />
              </AvatarFallback>
            </Avatar>
            <div className='space-y-1'>
              <p className='text-lg font-medium'>{presentation.label}</p>
              <p className='text-sm text-neutral-400'>{presentation.hint}</p>
            </div>
          </div>

          <div className='absolute inset-x-0 top-0 flex items-center justify-between p-4'>
            <div className='flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-sm'>
              <span className={cn('size-2 rounded-full', presentation.indicatorClassName)} />
              <span className='text-xs font-medium'>{presentation.label}</span>
            </div>
            <Badge variant='secondary' className='bg-black/40 text-neutral-200 backdrop-blur-sm'>
              Room {session.roomId}
            </Badge>
          </div>

          <div className='absolute right-4 bottom-4 aspect-video w-40 overflow-hidden rounded-xl border border-white/10 bg-neutral-900 shadow-lg sm:w-56'>
            <LocalVideoTile localStream={localStream} camOn={camOn} selfId={session.selfId} />
          </div>
        </div>

        <div className='flex items-center justify-center gap-3 border-t border-white/5 bg-neutral-950/80 p-4 backdrop-blur-sm'>
          <ControlButton
            label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            tone={micOn ? 'neutral' : 'danger'}
            onClick={() => setMicOn((on) => !on)}
          >
            {micOn ? <Mic /> : <MicOff />}
          </ControlButton>
          <ControlButton
            label={camOn ? 'Turn camera off' : 'Turn camera on'}
            tone={camOn ? 'neutral' : 'danger'}
            onClick={() => setCamOn((on) => !on)}
          >
            {camOn ? <Video /> : <VideoOff />}
          </ControlButton>
          <ControlButton label='Leave call' tone='danger' onClick={onLeaveRoom}>
            <PhoneOff />
          </ControlButton>
          <ControlButton label='Open chat' tone='neutral' onClick={() => setChatOpen(true)}>
            <MessageSquare />
          </ControlButton>
        </div>
      </div>

      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent side='right' className='flex w-full flex-col gap-0 p-0 sm:max-w-md'>
          <SheetHeader className='border-b'>
            <SheetTitle>Chat</SheetTitle>
            <SheetDescription>Messages are sent over the peer data channel.</SheetDescription>
          </SheetHeader>

          <ScrollArea className='flex-1'>
            <div className='p-4'>
              {view.messages.length === 0 ? (
                <p className='text-muted-foreground mt-8 text-center text-sm'>
                  No messages yet. Say hello once you are connected.
                </p>
              ) : (
                <ol className='flex flex-col gap-3' aria-label='Chat messages'>
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
        </SheetContent>
      </Sheet>
    </TooltipProvider>
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
        autoPlay
        muted
        playsInline
        className={cn('size-full -scale-x-100 object-cover', !camOn && 'invisible')}
      />
      {!camOn && (
        <div className='absolute inset-0 flex items-center justify-center bg-neutral-900'>
          <Avatar>
            <AvatarFallback className='bg-neutral-800 text-neutral-300'>
              {initials(selfId)}
            </AvatarFallback>
          </Avatar>
        </div>
      )}
      <span className='absolute bottom-1 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium'>
        You
      </span>
    </>
  );
}

function ControlButton({
  label,
  tone,
  onClick,
  children,
}: {
  readonly label: string;
  readonly tone: 'neutral' | 'danger';
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            variant='secondary'
            size='icon-lg'
            onClick={onClick}
            className={cn(
              'size-12 rounded-full',
              tone === 'danger' && 'bg-destructive text-white hover:bg-destructive/90',
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

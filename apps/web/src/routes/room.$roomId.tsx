import { CatchBoundary, createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { PeerId, RoomId } from '@tether/contracts/modules/room';
import { Button } from '@tether/ui/components/button';
import { Input } from '@tether/ui/components/input';
import { toast } from '@tether/ui/components/toast';
import { Check, Copy, Share2, X } from 'lucide-react';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { CallErrorScreen, CallLoadingScreen, CallScreen } from '@/modules/room/components/room';

export const Route = createFileRoute('/room/$roomId')({
  validateSearch: (search: Record<string, unknown>) => ({
    invite: search.invite === true || search.invite === 'true' ? true : undefined,
  }),
  component: RoomPage,
});

function RoomPage() {
  const { roomId } = Route.useParams();
  const { invite } = Route.useSearch();
  const navigate = useNavigate();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  const session: RoomSession = { roomId: RoomId.make(roomId), selfId };

  return (
    <CatchBoundary errorComponent={CallErrorScreen} getResetKey={() => roomId}>
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen
          session={session}
          onLeaveRoom={() => {
            void navigate({ to: '/' });
          }}
        />
      </Suspense>
      <RoomInviteCard
        open={invite ?? false}
        roomId={roomId}
        onClose={() => {
          void navigate({
            to: '/room/$roomId',
            params: { roomId },
            search: { invite: undefined },
            replace: true,
          });
        }}
      />
    </CatchBoundary>
  );
}

function RoomInviteCard({
  open,
  onClose,
  roomId,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly roomId: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!open) {
    return null;
  }

  const roomUrl = new URL(`/room/${encodeURIComponent(roomId)}`, window.location.origin).href;
  const canShare = typeof navigator.share === 'function';

  const copyRoomUrl = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error('Could not copy the room link');
    }
  };

  const shareRoomUrl = async () => {
    try {
      await navigator.share({
        title: 'Tether call',
        text: 'Join my Tether video call',
        url: roomUrl,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        toast.error('Could not share the room link');
      }
    }
  };

  return (
    <section
      aria-label='Room invite'
      className='border-border bg-card animate-in fade-in slide-in-from-bottom-4 fixed bottom-24 left-4 z-50 w-[min(26rem,calc(100vw-2rem))] border shadow-lg duration-300'
    >
      <div className='border-border flex items-center justify-between border-b px-4 py-2.5'>
        <span className='text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase'>
          Room ready
        </span>
        <Button aria-label='Close' variant='ghost' size='icon-sm' onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className='space-y-3 p-4'>
        <p className='text-sm leading-6'>
          Send this link to the one person you want to call. First to open it joins the line.
        </p>

        <div className='flex gap-2'>
          <Input
            aria-label='Room invite link'
            readOnly
            value={roomUrl}
            onFocus={(event) => event.currentTarget.select()}
            className='font-mono text-xs max-sm:text-[11px]'
          />
          <Button aria-label='Copy room link' variant='outline' onClick={() => void copyRoomUrl()}>
            {copied ? <Check className='text-success' /> : <Copy />}
            <span className='hidden sm:inline'>{copied ? 'Copied' : 'Copy'}</span>
          </Button>
        </div>

        {canShare && (
          <Button className='w-full' onClick={() => void shareRoomUrl()}>
            <Share2 />
            Share room
          </Button>
        )}
      </div>
    </section>
  );
}

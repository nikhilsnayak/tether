import { CatchBoundary, createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { PeerId, RoomId } from '@tether/contracts/modules/room';
import { Button } from '@tether/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@tether/ui/components/dialog';
import { Input } from '@tether/ui/components/input';
import { toast } from '@tether/ui/components/toast';
import { Check, Copy, Share2 } from 'lucide-react';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/ids';
import {
  PeerSessionError,
  PeerSessionLoading,
  RoomSessionScreen,
} from '@/modules/room/components/room';

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
    <CatchBoundary errorComponent={PeerSessionError} getResetKey={() => roomId}>
      <Suspense fallback={<PeerSessionLoading />}>
        <RoomSessionScreen
          session={session}
          onLeaveRoom={() => {
            void navigate({ to: '/' });
          }}
        />
      </Suspense>
      <RoomInviteDialog
        open={invite ?? false}
        roomId={roomId}
        onOpenChange={(open) => {
          if (!open) {
            void navigate({
              to: '/room/$roomId',
              params: { roomId },
              search: { invite: undefined },
              replace: true,
            });
          }
        }}
      />
    </CatchBoundary>
  );
}

function RoomInviteDialog({
  open,
  onOpenChange,
  roomId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='dark border-white/15 bg-neutral-950 text-neutral-100 shadow-2xl shadow-black/60'>
        <DialogHeader className='pr-8'>
          <DialogTitle>Your room is ready</DialogTitle>
          <DialogDescription className='leading-6 text-neutral-400'>
            Send this link to the person you want to call. Anyone with the link can request to join.
          </DialogDescription>
        </DialogHeader>

        {canShare && (
          <Button
            className='mt-6 h-10 w-full rounded-md bg-neutral-100 px-4 text-neutral-950 hover:bg-white'
            onClick={() => void shareRoomUrl()}
          >
            <Share2 />
            Share room
          </Button>
        )}

        <div className='mt-5 flex gap-2'>
          <Input
            aria-label='Room invite link'
            readOnly
            value={roomUrl}
            className='h-10 min-w-0 rounded-md border-white/15 bg-white/5 text-neutral-300 focus-visible:border-white/25 focus-visible:ring-white/15'
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            aria-label='Copy room link'
            variant='outline'
            className='h-10 rounded-md border-white/15 bg-transparent px-3 text-neutral-100 hover:bg-white/10 hover:text-white'
            onClick={() => void copyRoomUrl()}
          >
            {copied ? <Check /> : <Copy />}
            <span className='hidden sm:inline'>{copied ? 'Copied' : 'Copy'}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

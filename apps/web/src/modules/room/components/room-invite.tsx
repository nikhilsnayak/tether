import { useAtomValue } from '@effect/atom-react';
import { peerSessionViewAtom } from '@tether/client-runtime/modules/room';
import { Badge } from '@tether/ui/components/badge';
import { Button } from '@tether/ui/components/button';
import { Input } from '@tether/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@tether/ui/components/popover';
import { toast } from '@tether/ui/components/toast';
import { Check, Copy, Share2, X } from 'lucide-react';
import { useState } from 'react';

const DEFAULT_WEB_URL = 'https://tether.nikhilsnayak.dev';

export function RoomInvite() {
  const view = useAtomValue(peerSessionViewAtom);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  if (view.roomId === null) return null;

  const roomUrl = new URL(
    `/room/${encodeURIComponent(view.roomId)}`,
    import.meta.env.VITE_WEB_URL ??
      (window.location.protocol === 'http:' || window.location.protocol === 'https:'
        ? window.location.origin
        : DEFAULT_WEB_URL),
  ).href;
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Badge
            variant='secondary'
            className='pointer-events-auto font-mono tracking-[0.15em] uppercase'
            render={<button type='button' aria-label={`Room ${view.roomId}. Open room invite`} />}
          />
        }
      >
        <span className='max-sm:hidden'>Room&nbsp;</span>
        {view.roomId}
      </PopoverTrigger>
      <PopoverContent
        align='end'
        sideOffset={8}
        className='w-[min(26rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0 shadow-lg'
      >
        <section aria-label='Room invite'>
          <div className='border-border flex items-center justify-between border-b px-4 py-2.5'>
            <span className='text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase'>
              Room ready
            </span>
            <Button
              aria-label='Close room invite'
              variant='ghost'
              size='icon-sm'
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>
          <div className='space-y-3 p-4'>
            <p className='text-sm leading-6'>
              Send this link to the one person you want to call. They enter a name and knock; you
              let them in.
            </p>
            <div className='flex gap-2'>
              <Input
                aria-label='Room invite link'
                readOnly
                value={roomUrl}
                onFocus={(event) => event.currentTarget.select()}
                className='font-mono text-xs max-sm:text-[11px]'
              />
              <Button
                aria-label='Copy room link'
                variant='outline'
                onClick={() => void copyRoomUrl()}
              >
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
      </PopoverContent>
    </Popover>
  );
}

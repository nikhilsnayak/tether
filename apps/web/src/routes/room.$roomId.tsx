import { CatchBoundary, createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { DisplayName, PeerId, RoomId } from '@tether/contracts/modules/room';
import { Button } from '@tether/ui/components/button';
import { type SubmitEvent, Suspense, useEffect, useState } from 'react';

import { LogoMark } from '@/components/logo';
import { canOfferDesktopApp, desktopRoomUrl } from '@/lib/desktop-handoff';
import { generatePeerId } from '@/lib/utils';
import {
  CallErrorScreen,
  CallHandoffScreen,
  CallLoadingScreen,
  CallScreen,
} from '@/modules/room/components/room';

const MAX_DISPLAY_NAME = 32;

export const Route = createFileRoute('/room/$roomId')({
  component: RoomPage,
});

function RoomPage() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  // On a desktop web browser we hand off to the app first, so hold the call
  // (and its media grab) until the caller opts to stay in the browser.
  const [joinInBrowser, setJoinInBrowser] = useState(() => !canOfferDesktopApp());
  const [displayName, setDisplayName] = useState<DisplayName | null>(null);

  // Fire the tether:// scheme once; the browser's native "Open Tether?" prompt
  // takes over. If the app is absent or declined, the caller taps to join here.
  useEffect(() => {
    if (canOfferDesktopApp()) {
      window.location.href = desktopRoomUrl(roomId);
    }
  }, [roomId]);

  if (!joinInBrowser) {
    return <CallHandoffScreen onJoinInBrowser={() => setJoinInBrowser(true)} />;
  }

  if (displayName === null) {
    return <JoinNamePanel onSubmit={setDisplayName} />;
  }

  const session: RoomSession = {
    intent: 'join',
    roomId: RoomId.make(roomId),
    selfId,
    displayName,
  };

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
    </CatchBoundary>
  );
}

// Collected before media/session start: the joiner presents a name, the host
// approves or denies. Never persisted.
function JoinNamePanel({ onSubmit }: { readonly onSubmit: (name: DisplayName) => void }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const canContinue = trimmed.length > 0;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canContinue) {
      onSubmit(DisplayName.make(trimmed));
    }
  };

  return (
    <div className='grid min-h-svh place-items-center px-6'>
      <div className='w-full max-w-sm space-y-6'>
        <span className='flex items-center gap-2.5'>
          <LogoMark className='size-5' />
          <span className='font-medium tracking-tight'>tether</span>
        </span>
        <div className='space-y-3'>
          <p className='text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase'>
            Join call
          </p>
          <h1 className='text-2xl tracking-tight'>What should the host call you?</h1>
          <p className='text-muted-foreground text-sm leading-6'>
            The host sees this name before letting you in. It is not saved anywhere.
          </p>
        </div>
        <form onSubmit={handleSubmit} className='space-y-6'>
          <input
            aria-label='Your name'
            autoComplete='off'
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder='YOUR NAME'
            maxLength={MAX_DISPLAY_NAME}
            className='border-input placeholder:text-muted-foreground/70 focus:border-primary w-full border-b bg-transparent py-2 font-mono text-xl tracking-[0.15em] uppercase outline-none'
          />
          <Button type='submit' disabled={!canContinue} className='w-full'>
            Knock to join
          </Button>
        </form>
      </div>
    </div>
  );
}

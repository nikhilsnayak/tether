import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { type SubmitEvent, useState } from 'react';

import { LogoMark } from '@/components/logo';
import { formatRoomCodeInput, ROOM_CODE_LENGTH } from '@/lib/utils';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function PanelLabel({ children }: { readonly children: string }) {
  return (
    <p className='text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase'>
      {children}
    </p>
  );
}

function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const canJoin = code.length === ROOM_CODE_LENGTH;

  const handleJoin = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (canJoin && trimmed.length > 0) {
      void navigate({ to: '/room/$roomId', params: { roomId: trimmed } });
    }
  };

  return (
    <div className='grid grid-rows-[auto_1fr]'>
      <header className='flex items-center justify-between px-8 py-6'>
        <span className='flex items-center gap-2.5'>
          <LogoMark className='size-5' />
          <span className='font-medium tracking-tight'>tether</span>
        </span>
        <span className='text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase'>
          1:1 — video unit
        </span>
      </header>

      <main className='mx-auto grid w-full max-w-4xl content-center px-8 pb-20'>
        <div className='divide-border divide-y border-y'>
          <section className='grid gap-6 py-10 sm:grid-cols-[1fr_auto] sm:items-center'>
            <div className='space-y-3'>
              <PanelLabel>01 — new call</PanelLabel>
              <h1 className='text-3xl tracking-tight sm:text-4xl'>
                A direct video line
                <br />
                between two machines.
              </h1>
              <p className='text-muted-foreground max-w-sm pt-1 text-sm leading-6'>
                Press to generate a room code, hand it to one person. Nothing in between.
              </p>
            </div>
            <button
              type='button'
              onClick={() => void navigate({ to: '/host' })}
              className='bg-primary text-primary-foreground grid size-32 place-items-center justify-self-start rounded-full text-sm font-medium tracking-wide uppercase shadow-[inset_0_-4px_10px_rgba(0,0,0,0.35)] transition-transform active:scale-95 sm:justify-self-end'
            >
              Call
            </button>
          </section>

          <section className='grid gap-4 py-10 sm:grid-cols-[1fr_auto] sm:items-end'>
            <div className='space-y-3'>
              <PanelLabel>02 — join</PanelLabel>
              <form id='join-form' onSubmit={handleJoin}>
                <input
                  aria-label='Room code'
                  autoComplete='off'
                  value={code}
                  onChange={(event) => setCode(formatRoomCodeInput(event.target.value))}
                  placeholder='ROOM CODE'
                  maxLength={12}
                  className='border-input placeholder:text-muted-foreground/70 focus:border-primary w-full max-w-xs border-b bg-transparent py-2 font-mono text-xl tracking-[0.3em] uppercase outline-none'
                />
              </form>
            </div>
            <button
              type='submit'
              form='join-form'
              disabled={!canJoin}
              className='border-border hover:border-primary hover:text-primary justify-self-start border px-6 py-2.5 text-sm tracking-wide uppercase transition-colors disabled:opacity-50 sm:justify-self-end'
            >
              Connect
            </button>
          </section>
        </div>

        <div className='border-border mt-6 grid gap-4 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-center'>
          <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 font-mono text-[11px] tracking-[0.2em] uppercase'>
            <span className='flex items-center gap-1.5'>
              <span className='bg-primary size-1.5 rounded-full' />
              private video calls
            </span>
            <span className='flex items-center gap-1.5'>
              <span className='bg-primary size-1.5 rounded-full' />
              no accounts
            </span>
            <span className='flex items-center gap-1.5'>
              <span className='bg-primary size-1.5 rounded-full' />
              no call history
            </span>
          </div>
          <Link
            to='/terms'
            className='text-muted-foreground hover:text-primary font-mono text-[11px] tracking-[0.2em] uppercase underline underline-offset-4 sm:justify-self-end'
          >
            terms &amp; acceptable use
          </Link>
        </div>
      </main>
    </div>
  );
}

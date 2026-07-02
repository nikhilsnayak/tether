import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '@tether/ui/components/button';
import { Input } from '@tether/ui/components/input';
import { type SubmitEvent, useState } from 'react';

import { Wordmark } from '@/components/logo';
import { generateRoomId } from '@/lib/ids';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const enterRoom = (roomId: string, showInvite = false) => {
    const trimmed = roomId.trim();
    if (trimmed.length > 0) {
      void navigate({
        to: '/room/$roomId',
        params: { roomId: trimmed },
        search: { invite: showInvite ? true : undefined },
      });
    }
  };

  const handleJoin = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    enterRoom(code);
  };

  return (
    <div className='flex min-h-svh flex-col bg-neutral-950 text-neutral-100'>
      <header className='mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6'>
        <Wordmark className='text-neutral-100' />
        <span className='text-xs tracking-wide text-neutral-500'>1:1 video</span>
      </header>

      <main className='mx-auto flex w-full max-w-5xl flex-1 items-center px-6 py-16'>
        <div className='w-full max-w-xl'>
          <p className='mb-3 text-xs font-medium tracking-widest text-neutral-500 uppercase'>
            Peer-to-peer
          </p>
          <h1 className='max-w-lg text-3xl leading-tight font-medium tracking-tight sm:text-4xl'>
            Start a private video call.
          </h1>
          <p className='mt-4 max-w-md text-sm leading-6 text-neutral-400'>
            Create a room and send the code to one other person. No account or installation.
          </p>

          <div className='mt-12 border-y border-white/15'>
            <section className='flex items-center justify-between gap-6 py-6'>
              <div>
                <h2 className='text-sm font-medium'>New call</h2>
                <p className='mt-1 text-sm text-neutral-500'>Create a new room code.</p>
              </div>
              <Button
                className='rounded-md bg-neutral-100 px-5 text-neutral-950 hover:bg-white'
                onClick={() => enterRoom(generateRoomId(), true)}
              >
                Create room
              </Button>
            </section>

            <section className='border-t border-white/15 py-6'>
              <div className='mb-4'>
                <h2 className='text-sm font-medium'>Join a call</h2>
                <p className='mt-1 text-sm text-neutral-500'>Enter a room code you received.</p>
              </div>
              <form className='flex max-w-md gap-2' onSubmit={handleJoin}>
                <Input
                  aria-label='Room code'
                  autoComplete='off'
                  onChange={(event) => setCode(event.target.value)}
                  placeholder='Room code'
                  value={code}
                  className='h-10 rounded-md border-white/15 bg-transparent placeholder:text-neutral-600 focus-visible:ring-white/25'
                />
                <Button
                  type='submit'
                  variant='secondary'
                  disabled={code.trim().length === 0}
                  className='h-10 rounded-md border border-white/15 bg-transparent px-5 text-neutral-100 hover:bg-white/10'
                >
                  Join
                </Button>
              </form>
            </section>
          </div>
        </div>
      </main>

      <footer className='mx-auto w-full max-w-5xl px-6 py-6 text-xs text-neutral-600'>
        Calls connect directly between participants.
      </footer>
    </div>
  );
}

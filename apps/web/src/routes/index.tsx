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
    <div className='grid grid-rows-[auto_1fr_auto]'>
      <header className='mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6'>
        <Wordmark />
        <span className='text-muted-foreground text-xs tracking-wide'>1:1 video</span>
      </header>

      <main className='mx-auto flex w-full max-w-5xl items-center px-6 py-16'>
        <div className='w-full max-w-xl'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            Peer-to-peer
          </p>
          <h1 className='max-w-lg text-3xl leading-tight font-medium tracking-tight sm:text-4xl'>
            Start a private video call.
          </h1>
          <p className='text-muted-foreground mt-4 max-w-md text-sm leading-6'>
            Create a room and send the code to one other person. No account or installation.
          </p>

          <div className='border-border mt-12 border-y'>
            <section className='flex items-center justify-between gap-6 py-6'>
              <div>
                <h2 className='text-sm font-medium'>New call</h2>
                <p className='text-muted-foreground mt-1 text-sm'>Create a new room code.</p>
              </div>
              <Button onClick={() => enterRoom(generateRoomId(), true)}>Create room</Button>
            </section>

            <section className='border-border border-t py-6'>
              <div className='mb-4'>
                <h2 className='text-sm font-medium'>Join a call</h2>
                <p className='text-muted-foreground mt-1 text-sm'>
                  Enter a room code you received.
                </p>
              </div>
              <form className='flex max-w-md gap-2' onSubmit={handleJoin}>
                <Input
                  aria-label='Room code'
                  autoComplete='off'
                  onChange={(event) => setCode(event.target.value)}
                  placeholder='Room code'
                  value={code}
                />
                <Button type='submit' variant='outline' disabled={code.trim().length === 0}>
                  Join
                </Button>
              </form>
            </section>
          </div>
        </div>
      </main>

      <footer className='text-muted-foreground mx-auto w-full max-w-5xl px-6 py-6 text-xs'>
        Calls connect directly between participants.
      </footer>
    </div>
  );
}

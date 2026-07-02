import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '@tether/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@tether/ui/components/card';
import { Input } from '@tether/ui/components/input';
import { type SubmitEvent, useState } from 'react';

import { generateRoomId } from '@/lib/ids';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const enterRoom = (roomId: string) => {
    const trimmed = roomId.trim();
    if (trimmed.length > 0) {
      void navigate({ to: '/room/$roomId', params: { roomId: trimmed } });
    }
  };

  const handleJoin = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    enterRoom(code);
  };

  return (
    <main className='mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6'>
      <div>
        <h1 className='text-foreground text-2xl font-semibold'>Tether</h1>
        <p className='text-muted-foreground text-sm'>A private 1:1 video call.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New meeting</CardTitle>
          <CardDescription>Start a room and share its link with one person.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => enterRoom(generateRoomId())}>New meeting</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Join a meeting</CardTitle>
          <CardDescription>Enter the room code you were given.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className='flex gap-2' onSubmit={handleJoin}>
            <Input
              aria-label='Room code'
              autoComplete='off'
              onChange={(event) => setCode(event.target.value)}
              placeholder='abc-defg-hij'
              value={code}
            />
            <Button type='submit' variant='outline' disabled={code.trim().length === 0}>
              Join
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

import { PeerId, RoomId } from '@tether/contracts/modules/room';
import { useState } from 'react';

import { usePeerConnection } from '../hooks/use-peer-connection';
import type { RoomSession } from '../types';

export function RoomConfigurationScreen() {
  const [session, setSession] = useState<RoomSession | null>(null);

  return (
    <div className='flex flex-col gap-4'>
      <h2 className='text-lg font-semibold'>Room</h2>
      {!session ? (
        <button
          className='rounded-md bg-blue-500 px-4 py-2 text-white'
          onClick={() =>
            setSession({
              roomId: RoomId.make('demo-room'),
              selfId: PeerId.make(Date.now().toString()),
            })
          }
        >
          Join Room
        </button>
      ) : (
        <RoomSessionScreen session={session} />
      )}
    </div>
  );
}

function RoomSessionScreen({ session }: { session: RoomSession }) {
  usePeerConnection({ input: { roomId: session.roomId, selfId: session.selfId } });
  return (
    <div className='flex flex-col gap-4'>
      <h2 className='text-lg font-semibold'>Room Session</h2>
      <p>Room ID: {session.roomId}</p>
      <p>Self ID: {session.selfId}</p>
    </div>
  );
}

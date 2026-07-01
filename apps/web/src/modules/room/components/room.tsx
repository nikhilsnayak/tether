import { useAtomValue } from '@effect/atom-react';
import { CatchBoundary } from '@tanstack/react-router';
import type { PeerSessionView, RoomSession } from '@tether/client-runtime/modules/room';
import { PeerId, RoomId } from '@tether/contracts/modules/room';
import { Suspense, type FormEvent, useState } from 'react';

import { usePeerConnection } from '../hooks/use-peer-connection';
import { peerSessionViewAtom } from '../peer-session/view';

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
        <CatchBoundary
          errorComponent={PeerSessionError}
          getResetKey={() => `${session.roomId}:${session.selfId}`}
        >
          <Suspense fallback={<PeerSessionLoading />}>
            <RoomSessionScreen onLeaveRoom={() => setSession(null)} session={session} />
          </Suspense>
        </CatchBoundary>
      )}
    </div>
  );
}

function PeerSessionLoading() {
  return <p className='text-sm text-slate-600'>Starting peer session…</p>;
}

function PeerSessionError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Unknown peer-session failure';

  return (
    <div className='rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800'>
      Peer session failed: {message}
    </div>
  );
}

function peerSessionStatusPresentation(status: PeerSessionView['status']): {
  readonly indicatorClassName: string;
  readonly label: string;
  readonly messagePlaceholder: string;
} {
  switch (status) {
    case 'connecting':
      return {
        indicatorClassName: 'animate-pulse bg-amber-400',
        label: 'Connecting',
        messagePlaceholder: 'Waiting for peer…',
      };
    case 'connected':
      return {
        indicatorClassName: 'bg-emerald-500',
        label: 'Connected',
        messagePlaceholder: 'Write a message',
      };
    case 'disconnected':
      return {
        indicatorClassName: 'bg-slate-400',
        label: 'Signaling disconnected',
        messagePlaceholder: 'Signaling disconnected',
      };
    case 'failed':
      return {
        indicatorClassName: 'bg-red-500',
        label: 'Session failed',
        messagePlaceholder: 'Session failed',
      };
    case 'room-full':
      return {
        indicatorClassName: 'bg-red-500',
        label: 'Room is full',
        messagePlaceholder: 'This room already has two peers',
      };
    case 'peer-already-joined':
      return {
        indicatorClassName: 'bg-red-500',
        label: 'Peer already joined',
        messagePlaceholder: 'This peer identity is already active',
      };
    case 'waiting-for-peer':
      return {
        indicatorClassName: 'animate-pulse bg-amber-400',
        label: 'Waiting for peer',
        messagePlaceholder: 'Waiting for another peer…',
      };
    case 'transport-lost':
      return {
        indicatorClassName: 'bg-amber-500',
        label: 'Peer transport lost',
        messagePlaceholder: 'Connection to peer lost',
      };
  }
}

function RoomSessionScreen({
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
  const status = peerSessionStatusPresentation(view.status);
  const [draft, setDraft] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const message = draft.trim();
    if (message.length === 0 || view.status !== 'connected') {
      return;
    }

    if (sendMessage(message)) {
      setDraft('');
    }
  };

  return (
    <main className='mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 p-4 sm:p-8'>
      <header className='flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm'>
        <div>
          <h1 className='text-lg font-semibold text-slate-900'>Room {session.roomId}</h1>
          <p className='mt-1 text-xs text-slate-500'>You are {session.selfId}</p>
        </div>
        <div className='flex items-center gap-2 text-sm text-slate-600'>
          <span className={`size-2.5 rounded-full ${status.indicatorClassName}`} />
          {status.label}
        </div>
      </header>

      <section className='flex min-h-96 flex-1 flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm'>
        {view.messages.length === 0 ? (
          <div className='m-auto text-center'>
            <p className='text-sm font-medium text-slate-700'>No messages yet</p>
            <p className='mt-1 text-xs text-slate-500'>Messages from your peer will appear here.</p>
          </div>
        ) : (
          <ol className='flex flex-col gap-3' aria-label='Chat messages'>
            {view.messages.map((message) => (
              <li
                key={message.id}
                className={`flex ${message.sender === 'self' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
                    message.sender === 'self'
                      ? 'rounded-br-md bg-blue-600 text-white'
                      : 'rounded-bl-md border border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <p className='mb-1 text-[10px] font-medium tracking-wide uppercase opacity-70'>
                    {message.sender}
                  </p>
                  <p className='wrap-break-word whitespace-pre-wrap'>{message.text}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {view.status === 'room-full' ||
      view.status === 'peer-already-joined' ||
      view.status === 'disconnected' ||
      view.status === 'failed' ? (
        <button
          className='self-start rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
          onClick={onLeaveRoom}
          type='button'
        >
          Back to room setup
        </button>
      ) : (
        <form className='flex gap-2' onSubmit={handleSubmit}>
          <input
            aria-label='Message'
            className='min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100'
            disabled={view.status !== 'connected'}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={status.messagePlaceholder}
            value={draft}
          />
          <button
            className='rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300'
            disabled={view.status !== 'connected' || draft.trim().length === 0}
            type='submit'
          >
            Send
          </button>
        </form>
      )}
    </main>
  );
}

import { createFileRoute } from '@tanstack/react-router';

import { previewOpenRoomSession } from '../modules/room/client';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

function IndexPage() {
  const openPreview = () => {
    void previewOpenRoomSession({
      roomId: 'demo-room' as never,
      selfId: 'web-demo' as never,
    }).then((events) => {
      console.log('First room event batch:', events);
    });
  };

  return (
    <main className='mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 p-6 sm:p-10'>
      <header className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold'>Tether signaling</h1>
        <p className='text-muted-foreground text-sm'>
          Join the same room in two tabs to inspect events.
        </p>
      </header>

      <button
        className='w-fit rounded-md border px-3 py-2 text-sm'
        type='button'
        onClick={openPreview}
      >
        Preview room stream
      </button>
    </main>
  );
}

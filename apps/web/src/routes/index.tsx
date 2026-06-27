import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

function IndexPage() {
  return (
    <main className='mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 p-8'>
      <h1 className='text-2xl font-semibold'>Tether</h1>
      <p className='text-muted-foreground'>Empty canvas — the room slice goes here.</p>
    </main>
  );
}

import { useAtomValue } from '@effect/atom-react';
import { watchViewAtom, type WatchSessionView } from '@tether/client-runtime/modules/watch-along';
import { Button } from '@tether/ui/components/button';
import { Effect } from 'effect';
import { useRef, useState } from 'react';

import { useRoomExperience } from '../components/room-experience-context';
import { prepareWatchSource } from './source-adapter';

const statusLabel = (status: WatchSessionView['status']) => {
  switch (status) {
    case 'unavailable':
      return 'Waiting for a compatible peer';
    case 'idle':
      return 'Ready';
    case 'preparing-local':
    case 'awaiting-remote-start':
      return 'Loading';
    case 'loaded-paused':
      return 'Paused';
    case 'playing':
      return 'Playing';
    case 'ended':
      return 'Ended';
  }
};

export function WatchPanel() {
  const { binding } = useRoomExperience();
  const view = useAtomValue(watchViewAtom);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const chooseFile = (file: File) => {
    setError(null);
    Effect.runFork(
      prepareWatchSource(file).pipe(
        Effect.flatMap((prepared) => {
          if (binding.controller.watch.propose(prepared.source) === 'queued') return Effect.void;
          return Effect.promise(prepared.cancel).pipe(
            Effect.andThen(Effect.sync(() => setError('Watch is not ready'))),
          );
        }),
        Effect.catch(() => Effect.sync(() => setError('Unable to load this video'))),
      ),
    );
  };

  const control = (kind: 'play' | 'pause' | 'replay' | 'eject') => {
    binding.controller.watch.control({ kind });
  };

  return (
    <section
      aria-label='Watch together'
      data-watch-status={view.status}
      className='border-border bg-background/90 pointer-events-auto absolute top-20 right-4 z-50 w-[min(24rem,calc(100%-2rem))] space-y-3 rounded-xl border p-3 shadow-2xl backdrop-blur'
    >
      <div className='flex items-center justify-between gap-3'>
        <h2 className='font-medium'>Watch together</h2>
        <span className='text-muted-foreground text-sm'>{error ?? statusLabel(view.status)}</span>
      </div>

      <div className='flex flex-wrap gap-2'>
        {view.status === 'idle' && view.canPresent && (
          <Button size='sm' onClick={() => input.current?.click()}>
            Choose video
          </Button>
        )}
        {view.status === 'loaded-paused' && (
          <Button size='sm' onClick={() => control('play')}>
            Play
          </Button>
        )}
        {view.status === 'playing' && (
          <Button size='sm' onClick={() => control('pause')}>
            Pause
          </Button>
        )}
        {view.status === 'ended' && (
          <Button size='sm' onClick={() => control('replay')}>
            Replay
          </Button>
        )}
        {view.role !== null && (
          <Button size='sm' variant='outline' onClick={() => control('eject')}>
            Stop
          </Button>
        )}
      </div>

      <input
        ref={input}
        data-watch-file-input
        hidden
        type='file'
        accept='video/*'
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file !== undefined) chooseFile(file);
        }}
      />
    </section>
  );
}

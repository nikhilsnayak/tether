import { useAtomValue } from '@effect/atom-react';
import { watchViewAtom, type WatchSessionView } from '@tether/client-runtime/modules/watch-along';
import { Button } from '@tether/ui/components/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@tether/ui/components/popover';
import { toast } from '@tether/ui/components/toast';
import { Effect } from 'effect';
import { Clapperboard, LoaderCircle, Pause, Play, RotateCcw, Square, Upload } from 'lucide-react';
import { useRef } from 'react';

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

  const chooseFile = (file: File) => {
    Effect.runFork(
      prepareWatchSource(file).pipe(
        Effect.flatMap((prepared) => {
          if (binding.controller.watch.propose(prepared.source) === 'queued') return Effect.void;
          return Effect.promise(prepared.cancel).pipe(
            Effect.andThen(Effect.sync(() => toast.error('Watch is not ready'))),
          );
        }),
        Effect.catch(() => Effect.sync(() => toast.error('Unable to load this video'))),
      ),
    );
  };

  const control = (kind: 'play' | 'pause' | 'replay' | 'eject') => {
    binding.controller.watch.control({ kind });
  };

  const stop = () => {
    if (view.status === 'preparing-local' || view.status === 'awaiting-remote-start') {
      binding.controller.watch.cancel();
      return;
    }
    control('eject');
  };

  const TriggerIcon =
    view.status === 'playing'
      ? Play
      : view.status === 'loaded-paused'
        ? Pause
        : view.status === 'preparing-local' || view.status === 'awaiting-remote-start'
          ? LoaderCircle
          : Clapperboard;

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label='Watch together'
              variant='secondary'
              className='relative h-11 w-11 flex-col gap-1 rounded-xl sm:h-14 sm:w-16 sm:gap-1.5'
            />
          }
        >
          <TriggerIcon
            className={
              view.status === 'preparing-local' || view.status === 'awaiting-remote-start'
                ? 'animate-spin'
                : undefined
            }
          />
          <span className='font-mono text-[8px] tracking-[0.14em] uppercase sm:text-[9px] sm:tracking-[0.2em]'>
            watch
          </span>
          {view.status === 'playing' && (
            <span className='bg-success ring-background absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2' />
          )}
        </PopoverTrigger>
        <PopoverContent side='top' align='center' sideOffset={12} className='w-72 gap-3 p-3'>
          <PopoverHeader>
            <div className='flex items-center justify-between gap-3'>
              <PopoverTitle>Watch together</PopoverTitle>
              <span className='text-muted-foreground text-xs'>{statusLabel(view.status)}</span>
            </div>
            <PopoverDescription>Share a local video on the room display.</PopoverDescription>
          </PopoverHeader>

          <div className='flex gap-2'>
            {view.status === 'idle' && view.canPresent && (
              <Button className='flex-1' onClick={() => input.current?.click()}>
                <Upload />
                Choose video
              </Button>
            )}
            {view.status === 'loaded-paused' && (
              <Button className='flex-1' onClick={() => control('play')}>
                <Play />
                Play
              </Button>
            )}
            {view.status === 'playing' && (
              <Button className='flex-1' onClick={() => control('pause')}>
                <Pause />
                Pause
              </Button>
            )}
            {view.status === 'ended' && (
              <Button className='flex-1' onClick={() => control('replay')}>
                <RotateCcw />
                Replay
              </Button>
            )}
            {view.role !== null && (
              <Button variant='outline' onClick={stop}>
                <Square />
                Stop
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
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
    </>
  );
}

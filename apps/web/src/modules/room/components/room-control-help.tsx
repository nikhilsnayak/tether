import { Button } from '@tether/ui/components/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@tether/ui/components/hover-card';
import { CircleQuestionMark } from 'lucide-react';

const controls = [
  ['W / ↑', 'Move forward'],
  ['S / ↓', 'Move backward'],
  ['A D / ← →', 'Move sideways'],
  ['Drag', 'Orbit camera'],
  ['Scroll', 'Zoom'],
  ['R', 'Recenter camera'],
] as const;

export function RoomControlHelp() {
  return (
    <div data-room-scene-ignore-gesture className='absolute bottom-6 left-6 z-30'>
      <HoverCard>
        <HoverCardTrigger
          delay={350}
          closeDelay={200}
          render={
            <Button
              aria-label='Room controls help'
              className='rounded-full'
              size='icon-lg'
              type='button'
              variant='secondary'
            />
          }
        >
          <CircleQuestionMark />
        </HoverCardTrigger>
        <HoverCardContent side='top' align='start' className='w-64 space-y-3'>
          <div className='space-y-1'>
            <h2 className='font-mono text-xs tracking-[0.18em] uppercase'>Room controls</h2>
            <p className='text-muted-foreground text-xs'>Move your avatar and adjust your view.</p>
          </div>
          <dl className='grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-xs'>
            {controls.map(([keys, action]) => (
              <div key={keys} className='contents'>
                <dt>
                  <kbd className='bg-muted text-muted-foreground rounded px-1.5 py-1 font-mono text-[10px] whitespace-nowrap'>
                    {keys}
                  </kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

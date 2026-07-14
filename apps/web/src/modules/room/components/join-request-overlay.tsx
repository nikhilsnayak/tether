import { Button } from '@tether/ui/components/button';
import { User } from 'lucide-react';

export function JoinRequestOverlay({
  displayName,
  onDecision,
}: {
  readonly displayName: string;
  readonly onDecision: (decision: 'allow' | 'deny') => void;
}) {
  return (
    <div className='absolute right-5 bottom-24 z-50 w-[min(24rem,calc(100%-2rem))] max-sm:right-1/2 max-sm:bottom-28 max-sm:translate-x-1/2'>
      <section
        aria-label='Join request'
        className='border-border bg-card/95 space-y-4 rounded-xl border p-5 shadow-2xl backdrop-blur-sm'
      >
        <div className='flex items-center gap-2'>
          <User className='size-4' />
          <h2 className='font-mono text-xs tracking-[0.2em] uppercase'>A knock at the door</h2>
        </div>
        <p className='text-sm leading-6'>
          <span className='font-medium'>{displayName}</span> is waiting outside.
        </p>
        <p className='text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase'>
          This is the name they typed — it is not verified.
        </p>
        <div className='grid grid-cols-2 gap-2'>
          <Button variant='destructive' onClick={() => onDecision('deny')}>
            Keep out
          </Button>
          <Button onClick={() => onDecision('allow')}>Let in</Button>
        </div>
      </section>
    </div>
  );
}

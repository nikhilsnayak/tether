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
    <div className='bg-background/50 absolute inset-0 z-50 grid place-items-center px-4 backdrop-blur-sm'>
      <section
        aria-label='Join request'
        className='border-border bg-card w-[min(24rem,100%)] space-y-4 border p-5 shadow-lg'
      >
        <div className='flex items-center gap-2'>
          <User className='size-4' />
          <h2 className='font-mono text-xs tracking-[0.2em] uppercase'>Someone wants to join</h2>
        </div>
        <p className='text-sm leading-6'>
          <span className='font-medium'>{displayName}</span> is asking to join this call.
        </p>
        <p className='text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase'>
          This is the name they typed — it is not verified.
        </p>
        <div className='grid grid-cols-2 gap-2'>
          <Button variant='destructive' onClick={() => onDecision('deny')}>
            Deny
          </Button>
          <Button onClick={() => onDecision('allow')}>Allow</Button>
        </div>
      </section>
    </div>
  );
}

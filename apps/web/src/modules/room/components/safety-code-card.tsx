import { Button } from '@tether/ui/components/button';
import { ShieldCheck } from 'lucide-react';

export function SafetyCodeCard({
  code,
  onLeave,
  onConfirm,
}: {
  readonly code: string;
  readonly onLeave: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className='absolute inset-x-0 bottom-4 z-50 flex justify-center px-4'>
      <section
        aria-label='Safety check'
        className='border-border bg-background/85 max-w-sm space-y-3 rounded-md border p-4 backdrop-blur-sm'
      >
        <div className='flex items-center gap-2'>
          <ShieldCheck className='size-4' />
          <h2 className='font-mono text-xs tracking-[0.2em] uppercase'>Safety check</h2>
        </div>
        <p aria-label='Safety code' className='text-center font-mono text-lg tracking-widest'>
          {code}
        </p>
        <p className='text-muted-foreground text-sm'>
          Read this code aloud to each other. It proves that no one, not even the server, can see
          this call. Trust the call only if you both see the same code.
        </p>
        <div className='grid grid-cols-2 gap-2'>
          <Button size='sm' variant='destructive' onClick={onLeave}>
            They don&apos;t match
          </Button>
          <Button size='sm' onClick={onConfirm}>
            We see the same code
          </Button>
        </div>
      </section>
    </div>
  );
}

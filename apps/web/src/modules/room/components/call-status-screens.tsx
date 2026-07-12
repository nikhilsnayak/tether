import { Button } from '@tether/ui/components/button';
import { cn } from '@tether/ui/lib/utils';
import { AlertTriangle, LoaderCircle, Monitor } from 'lucide-react';
import { type ReactNode } from 'react';

import { LogoMark, Wordmark } from '@/components/logo';

function CallStatusScreen({
  indicatorClassName,
  pillLabel,
  icon,
  iconClassName,
  label,
  hint,
  action,
}: {
  readonly indicatorClassName: string;
  readonly pillLabel: string;
  readonly icon: ReactNode;
  readonly iconClassName?: string;
  readonly label: string;
  readonly hint: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className='relative z-40 grid content-center justify-items-center gap-6 px-6 text-center'>
      <div className='absolute top-4 right-4 left-4 flex items-center gap-3'>
        <Wordmark className='max-sm:hidden' />
        <LogoMark className='size-5 sm:hidden' />
        <div className='border-border flex min-w-0 items-center gap-2 border-l pl-3'>
          <span className={cn('size-2 shrink-0 rounded-full', indicatorClassName)} />
          <span className='truncate font-mono text-[11px] tracking-[0.15em] uppercase'>
            {pillLabel}
          </span>
        </div>
      </div>
      <div className='grid justify-items-center gap-5'>
        <div className={cn('border-border grid size-20 place-items-center border', iconClassName)}>
          {icon}
        </div>
        <div className='space-y-2'>
          <p className='font-mono text-sm tracking-[0.2em] uppercase'>{label}</p>
          <p className='text-muted-foreground max-w-sm text-sm'>{hint}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

export function CallLoadingScreen() {
  return (
    <CallStatusScreen
      indicatorClassName='animate-pulse bg-warning'
      pillLabel='Starting'
      icon={<LoaderCircle className='size-9 animate-spin' />}
      label='Starting your call…'
      hint='Setting up your connection.'
    />
  );
}

export function CallHandoffScreen({ onJoinInBrowser }: { readonly onJoinInBrowser: () => void }) {
  return (
    <CallStatusScreen
      indicatorClassName='animate-pulse bg-warning'
      pillLabel='Opening'
      icon={<Monitor className='size-9' />}
      label='Opening in the Tether app…'
      hint='No app, or want to stay here? Join this call in your browser.'
      action={
        <Button variant='secondary' onClick={onJoinInBrowser}>
          Join in this browser
        </Button>
      }
    />
  );
}

export function CallErrorScreen({
  error,
  reset,
}: {
  readonly error: unknown;
  readonly reset: () => void;
}) {
  const message = error instanceof Error ? error.message : 'Unknown peer-session failure';
  return (
    <CallStatusScreen
      indicatorClassName='bg-destructive'
      pillLabel='Failed'
      icon={<AlertTriangle className='size-9' />}
      iconClassName='bg-destructive/15 text-destructive'
      label='Something went wrong'
      hint={message}
      action={
        <Button variant='secondary' onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}

export function CallSessionErrorScreen({
  label,
  hint,
  onLeaveRoom,
  indicatorClassName,
}: {
  readonly label: string;
  readonly hint: string;
  readonly onLeaveRoom: () => void;
  readonly indicatorClassName: string;
}) {
  return (
    <CallStatusScreen
      indicatorClassName={indicatorClassName}
      pillLabel={label}
      icon={<AlertTriangle className='size-9' />}
      iconClassName='bg-destructive/15 text-destructive'
      label={label}
      hint={hint}
      action={
        <Button variant='secondary' onClick={onLeaveRoom}>
          Back to room setup
        </Button>
      }
    />
  );
}

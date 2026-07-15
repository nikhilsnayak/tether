import { Button } from '@tether/ui/components/button';
import { cn } from '@tether/ui/lib/utils';
import { AlertTriangle, LoaderCircle, Monitor, RefreshCw } from 'lucide-react';
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
    <div className='relative z-40 grid min-h-svh content-center justify-items-center gap-6 px-6 text-center'>
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
      pillLabel='Entering'
      icon={<LoaderCircle className='size-9 animate-spin' />}
      label='Entering the room…'
      hint='Setting up your private connection.'
    />
  );
}

export function RoomMetadataLoadingScreen() {
  return (
    <CallStatusScreen
      indicatorClassName='animate-pulse bg-warning'
      pillLabel='Preparing room'
      icon={<LoaderCircle className='size-9 animate-spin' />}
      label='Checking the room…'
      hint='Reading the room details before requesting camera access.'
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

const MISSING_CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  'secure-context': 'secure context (HTTPS)',
  webgl2: 'WebGL2',
  'user-media': 'camera and microphone access',
  'peer-connection': 'WebRTC',
};

function formatMissingCapabilities(missing: ReadonlyArray<string>): string {
  return missing.map((id) => MISSING_CAPABILITY_LABELS[id] ?? id).join(', ');
}

export function UnsupportedBrowserScreen({
  missing,
  onLeave,
}: {
  readonly missing: ReadonlyArray<string>;
  readonly onLeave: () => void;
}) {
  return (
    <CallStatusScreen
      indicatorClassName='bg-destructive'
      pillLabel='Unsupported'
      icon={<AlertTriangle className='size-9' />}
      iconClassName='bg-destructive/15 text-destructive'
      label='This browser cannot enter the room'
      hint={`A secure browser with WebGL2, camera access, and WebRTC is required. Missing: ${formatMissingCapabilities(missing)}.`}
      action={<Button onClick={onLeave}>Return home</Button>}
    />
  );
}

export function UpdateRequiredScreen({ onLeave }: { readonly onLeave: () => void }) {
  return (
    <CallStatusScreen
      indicatorClassName='bg-warning'
      pillLabel='Update required'
      icon={<RefreshCw className='size-9' />}
      label='This room needs a newer Tether'
      hint='The room uses a template this version does not recognize.'
      action={<Button onClick={onLeave}>Return home</Button>}
    />
  );
}

export function RoomMissingScreen({ onLeave }: { readonly onLeave: () => void }) {
  return (
    <CallStatusScreen
      indicatorClassName='bg-destructive'
      pillLabel='Room unavailable'
      icon={<AlertTriangle className='size-9' />}
      iconClassName='bg-destructive/15 text-destructive'
      label='This room is no longer here'
      hint='Check the room code or ask the host for a new invitation.'
      action={<Button onClick={onLeave}>Return home</Button>}
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

export function SessionAcquisitionErrorScreen({
  error,
  onRestartMediaSetup,
}: {
  readonly error: unknown;
  readonly onRestartMediaSetup: () => void;
}) {
  const message = error instanceof Error ? error.message : 'Could not start the session';
  return (
    <CallStatusScreen
      indicatorClassName='bg-destructive'
      pillLabel='Failed'
      icon={<AlertTriangle className='size-9' />}
      iconClassName='bg-destructive/15 text-destructive'
      label='Could not join'
      hint={message}
      action={
        <Button variant='secondary' onClick={onRestartMediaSetup}>
          Check media and try again
        </Button>
      }
    />
  );
}

export function CallSessionErrorScreen({
  label,
  pillLabel,
  hint,
  onLeaveRoom,
  indicatorClassName,
}: {
  readonly label: string;
  readonly pillLabel: string;
  readonly hint: string;
  readonly onLeaveRoom: () => void;
  readonly indicatorClassName: string;
}) {
  return (
    <CallStatusScreen
      indicatorClassName={indicatorClassName}
      pillLabel={pillLabel}
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

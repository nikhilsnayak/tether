import { Button } from '@tether/ui/components/button';
import { cn } from '@tether/ui/lib/utils';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';

import { LogoMark } from '@/components/logo';

import { CallControlButton } from '../components/call-controls';
import { MediaStreamVideo } from '../components/media-stream-video';
import { RoomScene } from '../scene/room-scene';
import type { RoomTemplate } from '../templates/registry';
import type { PreparedMediaSelection } from './media';
import { useMediaPreflight } from './use-media-preflight';

export function MediaSetupPanel({
  template,
  entryContext = 'host',
  actionLabel,
  onBack,
  onComplete,
}: {
  readonly template: RoomTemplate;
  readonly entryContext?: 'host' | 'guest';
  readonly actionLabel: string;
  readonly onBack: () => void;
  readonly onComplete: (selection: PreparedMediaSelection) => void;
}) {
  const { status, stream, settings, error, acquire, release, transfer, updateSettings } =
    useMediaPreflight();

  const finish = () => {
    onComplete(transfer());
  };
  const guestEntry = entryContext === 'guest';

  return (
    <div className='relative isolate grid min-h-svh place-items-center overflow-hidden px-6 py-10'>
      {guestEntry && (
        <RoomScene template={template} journey='outside' mode='call' sessionIntent='join' />
      )}
      <div
        className={cn(
          'relative z-10 w-full max-w-xl space-y-6',
          guestEntry &&
            'border-border bg-background/95 rounded-xl border p-6 shadow-2xl backdrop-blur-sm sm:p-8',
        )}
      >
        <span className='flex items-center gap-2.5'>
          <LogoMark className='size-5' />
          <span className='font-medium tracking-tight'>tether</span>
        </span>
        <div className='space-y-2'>
          <p className='text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase'>
            Checking media — {template.name}
          </p>
          <h1 className='text-2xl tracking-tight'>Look and sound ready?</h1>
          <p className='text-muted-foreground text-sm leading-6'>
            {guestEntry
              ? 'You are outside the private room. Check your camera and microphone before knocking; this preview is never sent.'
              : 'Check your default camera and microphone before entering. This preview is never sent.'}
          </p>
        </div>

        {status === 'idle' && <Button onClick={() => void acquire()}>Continue</Button>}
        {status === 'acquiring' && (
          <output className='text-muted-foreground block text-sm'>
            Asking for camera and microphone access…
          </output>
        )}
        {status === 'failed' && (
          <div className='border-destructive/50 bg-destructive/10 space-y-3 border p-4'>
            <p className='font-medium'>Camera or microphone unavailable</p>
            <p className='text-muted-foreground text-sm'>
              {error instanceof Error ? error.message : 'Check browser permissions and devices.'}
            </p>
            <Button variant='secondary' onClick={() => void acquire()}>
              Try again
            </Button>
          </div>
        )}
        {status === 'ready' && (
          <>
            <div className='border-border bg-card aspect-video overflow-hidden rounded-md border'>
              <MediaStreamVideo
                stream={stream}
                aria-label='Camera preview'
                autoPlay
                muted
                playsInline
                className={cn(
                  'size-full -scale-x-100 object-cover',
                  !settings.camera && 'invisible',
                )}
              />
            </div>
            <div className='flex justify-center gap-3'>
              <CallControlButton
                label={settings.microphone ? 'Mute microphone' : 'Unmute microphone'}
                caption='mic'
                tone={settings.microphone ? 'neutral' : 'danger'}
                onClick={() => updateSettings({ ...settings, microphone: !settings.microphone })}
              >
                {settings.microphone ? <Mic /> : <MicOff />}
              </CallControlButton>
              <CallControlButton
                label={settings.camera ? 'Turn camera off' : 'Turn camera on'}
                caption='cam'
                tone={settings.camera ? 'neutral' : 'danger'}
                onClick={() => updateSettings({ ...settings, camera: !settings.camera })}
              >
                {settings.camera ? <Video /> : <VideoOff />}
              </CallControlButton>
            </div>
            <Button className='w-full' onClick={finish}>
              {actionLabel}
            </Button>
          </>
        )}
        <Button
          variant='ghost'
          onClick={() => {
            release();
            onBack();
          }}
        >
          Back
        </Button>
      </div>
    </div>
  );
}

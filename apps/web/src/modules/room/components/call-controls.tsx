import { Button } from '@tether/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@tether/ui/components/tooltip';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { type ReactNode } from 'react';

export function CallControlButton({
  label,
  caption,
  tone,
  onClick,
  indicator = false,
  children,
}: {
  readonly label: string;
  readonly caption: string;
  readonly tone: 'neutral' | 'danger';
  readonly onClick: () => void;
  readonly indicator?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            variant={tone === 'danger' ? 'destructive' : 'secondary'}
            onClick={onClick}
            className='relative h-11 w-11 flex-col gap-1 rounded-xl sm:h-14 sm:w-16 sm:gap-1.5'
          />
        }
      >
        {children}
        <span className='font-mono text-[8px] tracking-[0.14em] uppercase sm:text-[9px] sm:tracking-[0.2em]'>
          {caption}
        </span>
        {indicator && (
          <span className='bg-primary ring-background absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2' />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Mic and camera toggles are the only controls shared between the in-call dock
// and the outside waiting card, so they live here rather than being duplicated.
export function MediaToggleControls({
  micOn,
  cameraOn,
  onMicToggle,
  onCameraToggle,
}: {
  readonly micOn: boolean;
  readonly cameraOn: boolean;
  readonly onMicToggle: () => void;
  readonly onCameraToggle: () => void;
}) {
  return (
    <>
      <CallControlButton
        label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        caption='mic'
        tone={micOn ? 'neutral' : 'danger'}
        onClick={onMicToggle}
      >
        {micOn ? <Mic /> : <MicOff />}
      </CallControlButton>
      <CallControlButton
        label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        caption='cam'
        tone={cameraOn ? 'neutral' : 'danger'}
        onClick={onCameraToggle}
      >
        {cameraOn ? <Video /> : <VideoOff />}
      </CallControlButton>
    </>
  );
}

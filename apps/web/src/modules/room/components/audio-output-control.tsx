import { useAtomValue } from '@effect/atom-react';
import { peerLocalStreamAtom } from '@tether/client-runtime/modules/room';
import { Button } from '@tether/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tether/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@tether/ui/components/tooltip';
import { Volume2, VolumeX } from 'lucide-react';

import { useAudioOutputDevices } from '../hooks/use-audio-output-devices';
import { mediaStreamValue } from '../peer-session/platform';

export const SPEAKER_OFF = '__off__';

export function AudioOutputControl({
  sinkId,
  speakerOn,
  onChange,
}: {
  readonly sinkId: string;
  readonly speakerOn: boolean;
  readonly onChange: (value: string) => void;
}) {
  const localStreamHandle = useAtomValue(peerLocalStreamAtom);
  const localStream = localStreamHandle === null ? null : mediaStreamValue(localStreamHandle);
  const outputs = useAudioOutputDevices(localStream);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label='Audio output'
                  variant={speakerOn ? 'secondary' : 'destructive'}
                  className='h-14 w-14 flex-col gap-1.5 rounded-sm sm:w-16'
                />
              }
            />
          }
        >
          {speakerOn ? <Volume2 /> : <VolumeX />}
          <span className='font-mono text-[9px] tracking-[0.2em] uppercase'>out</span>
        </TooltipTrigger>
        <TooltipContent>Audio output</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side='top' align='center' className='max-w-(--available-width)'>
        <DropdownMenuRadioGroup
          value={speakerOn ? sinkId || 'default' : SPEAKER_OFF}
          onValueChange={onChange}
        >
          <DropdownMenuLabel>Audio output</DropdownMenuLabel>
          {outputs.map((device, index) => (
            <DropdownMenuRadioItem
              key={device.deviceId}
              value={device.deviceId || 'default'}
              className='whitespace-nowrap'
            >
              {device.label || `Speaker ${index + 1}`}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={SPEAKER_OFF}>Off</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

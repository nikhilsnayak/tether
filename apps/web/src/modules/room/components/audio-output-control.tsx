import { useAtomValue } from '@effect/atom-react';
import { peerLocalStreamAtom } from '@tether/client-runtime/modules/room';
import { Button } from '@tether/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tether/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@tether/ui/components/tooltip';
import { Volume2, VolumeX } from 'lucide-react';

import { useAudioOutputDevices } from '../hooks/use-audio-output-devices';
import { useProgramAudioPreferences } from '../hooks/use-program-audio-preferences';
import { mediaStreamValue } from '../peer-session/platform';

const SPEAKER_OFF = '__off__';

export function AudioOutputControl() {
  const localStreamHandle = useAtomValue(peerLocalStreamAtom);
  const localStream = localStreamHandle === null ? null : mediaStreamValue(localStreamHandle);
  const outputs = useAudioOutputDevices(localStream);
  const { preferences, setPreferences } = useProgramAudioPreferences();
  const handleOutputChange = (value: string) => {
    setPreferences(
      value === SPEAKER_OFF
        ? { ...preferences, speakerEnabled: false }
        : { ...preferences, sinkId: value, speakerEnabled: true },
    );
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label='Audio output'
                  variant={preferences.speakerEnabled ? 'secondary' : 'destructive'}
                  className='h-11 w-11 flex-col gap-1 rounded-xl sm:h-14 sm:w-16 sm:gap-1.5'
                />
              }
            />
          }
        >
          {preferences.speakerEnabled ? <Volume2 /> : <VolumeX />}
          <span className='font-mono text-[8px] tracking-[0.14em] uppercase sm:text-[9px] sm:tracking-[0.2em]'>
            out
          </span>
        </TooltipTrigger>
        <TooltipContent>Audio output</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side='top' align='center' className='max-w-(--available-width)'>
        <DropdownMenuRadioGroup
          value={preferences.speakerEnabled ? preferences.sinkId || 'default' : SPEAKER_OFF}
          onValueChange={handleOutputChange}
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
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className='space-y-2'>
            <span className='flex items-center justify-between gap-4'>
              <span>Program volume</span>
              <span className='font-mono text-xs'>{Math.round(preferences.volume * 100)}%</span>
            </span>
            <input
              aria-label='Program volume'
              className='accent-primary block w-full'
              type='range'
              min='0'
              max='1'
              step='0.05'
              value={preferences.volume}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  volume: event.currentTarget.valueAsNumber,
                })
              }
            />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Button } from '@tether/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@tether/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@tether/ui/components/tooltip';
import { Gauge } from 'lucide-react';
import { useState } from 'react';

import type { QualityPreference } from '../scene/config';

const QUALITY_OPTIONS = [
  ['auto', 'Auto quality'],
  ['high', 'High quality'],
  ['medium', 'Medium quality'],
  ['low', 'Low quality'],
] as const satisfies ReadonlyArray<readonly [QualityPreference, string]>;

export function RoomQualityControl({
  preference,
  onChange,
}: {
  readonly preference: QualityPreference;
  readonly onChange: (preference: QualityPreference) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={`Room quality: ${preference}`}
                  data-quality-preference={preference}
                  data-room-quality-control
                  variant='secondary'
                  className='h-11 w-11 flex-col gap-1 rounded-xl sm:h-14 sm:w-16 sm:gap-1.5'
                />
              }
            />
          }
        >
          <Gauge />
          <span className='font-mono text-[8px] tracking-[0.14em] uppercase sm:text-[9px] sm:tracking-[0.2em]'>
            {preference}
          </span>
        </TooltipTrigger>
        <TooltipContent>Room quality</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side='top' align='center'>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            onChange(value as QualityPreference);
            setOpen(false);
          }}
        >
          <DropdownMenuLabel>Room quality</DropdownMenuLabel>
          {QUALITY_OPTIONS.map(([value, label]) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Button } from '@tether/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@tether/ui/components/tooltip';
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
            className='relative h-14 w-14 flex-col gap-1.5 rounded-sm sm:w-16'
          />
        }
      >
        {children}
        <span className='font-mono text-[9px] tracking-[0.2em] uppercase'>{caption}</span>
        {indicator && (
          <span className='bg-primary ring-background absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2' />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

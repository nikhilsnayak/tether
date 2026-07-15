'use client';

import { PreviewCard as HoverCardPrimitive } from '@base-ui/react/preview-card';
import { cn } from '@tether/ui/lib/utils';

function HoverCard({ ...props }: HoverCardPrimitive.Root.Props) {
  return <HoverCardPrimitive.Root data-slot='hover-card' {...props} />;
}

function HoverCardTrigger({ ...props }: HoverCardPrimitive.Trigger.Props) {
  return <HoverCardPrimitive.Trigger data-slot='hover-card-trigger' {...props} />;
}

function HoverCardContent({
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  className,
  ...props
}: HoverCardPrimitive.Popup.Props &
  Pick<HoverCardPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className='isolate z-50 outline-none'
      >
        <HoverCardPrimitive.Popup
          data-slot='hover-card-content'
          className={cn(
            'bg-popover text-popover-foreground z-50 w-64 origin-(--transform-origin) rounded-xl border p-4 shadow-md outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        />
      </HoverCardPrimitive.Positioner>
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };

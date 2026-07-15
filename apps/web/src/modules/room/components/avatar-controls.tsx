import { Button } from '@tether/ui/components/button';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LocateFixed } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import type { AvatarControl } from '../hooks/use-avatar-controls';

export function AvatarControls({
  disabled,
  onHeldChange,
  onRecenter,
}: {
  readonly disabled: boolean;
  readonly onHeldChange: (control: AvatarControl, held: boolean) => void;
  readonly onRecenter: () => void;
}) {
  const heldButtonProps = (control: AvatarControl) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      onHeldChange(control, true);
    },
    onPointerUp: () => onHeldChange(control, false),
    onPointerCancel: () => onHeldChange(control, false),
    onLostPointerCapture: () => onHeldChange(control, false),
  });

  const controlButton = (
    control: AvatarControl,
    label: string,
    icon: ReactNode,
    className: string,
  ) => (
    <Button
      {...heldButtonProps(control)}
      aria-label={label}
      className={className}
      disabled={disabled}
      size='icon-sm'
      type='button'
      variant='secondary'
    >
      {icon}
    </Button>
  );

  return (
    <div
      data-room-scene-ignore-gesture
      aria-label='Avatar controls'
      className='absolute bottom-24 left-3 z-20 hidden grid-cols-3 gap-1 sm:bottom-28 sm:left-4 [@media(pointer:coarse)]:grid'
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role='group'
    >
      {controlButton('forward', 'Move avatar forward', <ArrowUp />, 'col-start-2')}
      {controlButton('left', 'Turn avatar left', <ArrowLeft />, 'col-start-1 row-start-2')}
      {controlButton('backward', 'Move avatar backward', <ArrowDown />, 'row-start-2')}
      {controlButton('right', 'Turn avatar right', <ArrowRight />, 'row-start-2')}
      <Button
        aria-label='Recenter camera'
        className='col-start-2 row-start-3'
        onClick={onRecenter}
        size='icon-sm'
        type='button'
        variant='secondary'
      >
        <LocateFixed />
      </Button>
    </div>
  );
}

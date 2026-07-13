import { Button } from '@tether/ui/components/button';

import { LogoMark } from '@/components/logo';

import { RoomScenePreview } from '../scene/room-scene-preview';
import { DUSK_SUITE_TEMPLATE, type RoomTemplate } from '../templates/registry';

export function TemplateSelectionPanel({
  onSelect,
  onBack,
}: {
  readonly onSelect: (template: RoomTemplate) => void;
  readonly onBack: () => void;
}) {
  return (
    <div className='grid min-h-svh place-items-center px-6'>
      <div className='w-full max-w-xl space-y-6'>
        <span className='flex items-center gap-2.5'>
          <LogoMark className='size-5' />
          <span className='font-medium tracking-tight'>tether</span>
        </span>
        <div className='space-y-2'>
          <p className='text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase'>
            Preparing room
          </p>
          <h1 className='text-2xl tracking-tight'>Choose a place to meet</h1>
        </div>
        <RoomScenePreview template={DUSK_SUITE_TEMPLATE} />
        <button
          type='button'
          onClick={() => onSelect(DUSK_SUITE_TEMPLATE)}
          className='border-primary bg-card w-full space-y-2 border p-6 text-left'
        >
          <span className='font-medium'>{DUSK_SUITE_TEMPLATE.name}</span>
          <span className='text-muted-foreground block text-sm leading-6'>
            {DUSK_SUITE_TEMPLATE.description}
          </span>
        </button>
        <div className='flex gap-3'>
          <Button variant='ghost' onClick={onBack}>
            Back
          </Button>
          <Button onClick={() => onSelect(DUSK_SUITE_TEMPLATE)}>Set up Dusk Suite</Button>
        </div>
      </div>
    </div>
  );
}

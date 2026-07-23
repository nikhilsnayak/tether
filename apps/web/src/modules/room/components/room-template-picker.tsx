import { ROOM_TEMPLATES, type RoomTemplate } from '../templates/registry';

interface RoomTemplatePickerProps {
  readonly selected: RoomTemplate;
  readonly onSelect: (template: RoomTemplate) => void;
  readonly onContinue: () => void;
  readonly onBack: () => void;
}

export function RoomTemplatePicker({
  selected,
  onSelect,
  onContinue,
  onBack,
}: RoomTemplatePickerProps) {
  return (
    <main className='mx-auto grid min-h-svh w-full max-w-4xl content-center gap-8 px-8 py-16'>
      <div className='space-y-3'>
        <p className='text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase'>
          New call — Choose a room
        </p>
        <h1 className='text-3xl tracking-tight sm:text-4xl'>Where should you meet?</h1>
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        {ROOM_TEMPLATES.map((template) => {
          const isSelected = template.id === selected.id;
          return (
            <button
              key={template.id}
              type='button'
              aria-pressed={isSelected}
              onClick={() => onSelect(template)}
              className={`space-y-3 border p-6 text-left transition-colors ${
                isSelected ? 'border-primary' : 'border-border hover:border-primary'
              }`}
            >
              <span className='block text-lg font-medium'>{template.name}</span>
              <span className='text-muted-foreground block text-sm leading-6'>
                {template.description}
              </span>
              <span
                className={`block font-mono text-[10px] tracking-[0.2em] uppercase ${
                  template.watchAlong === undefined ? 'text-muted-foreground' : 'text-primary'
                }`}
              >
                {template.watchAlong === undefined ? 'Private call' : 'Watch Together'}
              </span>
            </button>
          );
        })}
      </div>

      <div className='flex flex-col gap-3 sm:flex-row'>
        <button
          type='button'
          onClick={onContinue}
          className='bg-primary text-primary-foreground px-6 py-2.5 text-sm tracking-wide uppercase'
        >
          Continue
        </button>
        <button
          type='button'
          onClick={onBack}
          className='border-border hover:border-primary border px-6 py-2.5 text-sm tracking-wide uppercase'
        >
          Back
        </button>
      </div>
    </main>
  );
}

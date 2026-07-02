import { cn } from '@tether/ui/lib/utils';

export function LogoMark({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role='img'
      aria-label='Tether'
      className={cn('size-6', className)}
    >
      {/* the tether */}
      <path d='M9.4 14.6 14.6 9.4' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' />
      {/* peer one — live */}
      <circle cx='7' cy='17' r='3.4' fill='currentColor' />
      <circle cx='7' cy='17' r='6' stroke='currentColor' strokeWidth='1.2' opacity='0.35' />
      {/* peer two */}
      <circle cx='17' cy='7' r='3.4' fill='currentColor' />
    </svg>
  );
}

export function Wordmark({ className }: { readonly className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className='text-[1.2em] leading-none font-medium tracking-[-0.03em]'>tether</span>
    </span>
  );
}

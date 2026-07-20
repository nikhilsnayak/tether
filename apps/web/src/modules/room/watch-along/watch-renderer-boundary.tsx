import { CatchBoundary } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { WatchRendererHealth } from './renderer-health';

export function WatchRendererBoundary({
  active,
  health,
  children,
}: {
  readonly active: boolean;
  readonly health: WatchRendererHealth;
  readonly children: ReactNode;
}) {
  return (
    <CatchBoundary
      errorComponent={() => null}
      getResetKey={() => String(active)}
      onCatch={() => health.fail('render-error', active)}
    >
      {children}
    </CatchBoundary>
  );
}

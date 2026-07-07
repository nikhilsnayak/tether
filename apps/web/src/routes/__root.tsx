import { RegistryProvider } from '@effect/atom-react';
import { TanStackDevtools } from '@tanstack/react-devtools';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { TooltipProvider } from '@tether/ui/components/tooltip';

import { DisclaimerGate } from '@/components/disclaimer-gate';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <RegistryProvider>
      <TooltipProvider delay={200}>
        <DisclaimerGate>
          <Outlet />
        </DisclaimerGate>
      </TooltipProvider>
      <TanStackDevtools
        plugins={[
          {
            name: 'TanStack Router',
            render: <TanStackRouterDevtoolsPanel />,
          },
        ]}
      />
    </RegistryProvider>
  );
}

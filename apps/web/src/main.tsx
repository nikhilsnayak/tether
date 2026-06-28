import '@tether/ui/globals.css';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { Toaster } from '@tether/ui/components/toast';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

import { routeTree } from './routeTree.gen';

const router = createRouter({
  routeTree,
  scrollRestoration: true,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement?.innerHTML) {
  const root = ReactDOM.createRoot(rootElement!);

  root.render(
    <StrictMode>
      <RouterProvider router={router} />
      <Toaster />
    </StrictMode>,
  );
}

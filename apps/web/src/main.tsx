import '@tether/ui/globals.css';
import { RegistryProvider } from '@effect/atom-react';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { serverUrlAtom } from '@tether/client-runtime';
import { Toaster } from '@tether/ui/components/toast';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

import { routeTree } from './routeTree.gen';

const serverUrl = import.meta.env.VITE_SERVER_URL;

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
      <RegistryProvider initialValues={[[serverUrlAtom, serverUrl]]}>
        <RouterProvider router={router} />
        <Toaster />
      </RegistryProvider>
    </StrictMode>,
  );
}

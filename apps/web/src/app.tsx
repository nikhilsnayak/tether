import { RouterProvider, createHashHistory, createRouter } from '@tanstack/react-router';
import { Toaster } from '@tether/ui/components/toast';

import { routeTree } from './routeTree.gen';

// The History API can only push path-based URLs on http(s) origins. Anywhere
// else (e.g. a bundle opened straight from the filesystem) falls back to hash
// routing.
const isWebOrigin =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:');

const router = createRouter({
  routeTree,
  scrollRestoration: true,
  defaultPreload: 'intent',
  ...(isWebOrigin ? {} : { history: createHashHistory() }),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}

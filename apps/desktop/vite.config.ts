import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The renderer is the web app's source, so it mirrors apps/web/vite.config.ts:
// the same React + compiler + Tailwind pipeline, plus the `@` alias the web
// code resolves via tsconfig paths. `base: './'` keeps asset URLs relative so
// the production bundle loads over file:// inside Electron. The signaling
// server URL comes from the reused web app-client (deployed by default,
// overridable with VITE_SERVER_URL via apps/desktop/.env).
const DEVELOPMENT_CSP_NONCE = randomBytes(16).toString('base64url');

export default defineConfig(async ({ command }) => {
  const { devtools } = await import('@tanstack/devtools-vite');
  const isDevelopmentServer = command === 'serve';

  return {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'build'),
    base: './',
    envDir: __dirname,
    html: isDevelopmentServer ? { cspNonce: DEVELOPMENT_CSP_NONCE } : undefined,
    server: {
      port: 5273,
      strictPort: true,
    },
    resolve: {
      alias: { '@': resolve(__dirname, '../web/src') },
    },
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      emptyOutDir: true,
    },
    plugins: [
      {
        name: 'desktop-development-csp',
        apply: 'serve',
        transformIndexHtml: {
          order: 'pre',
          handler: (html: string) =>
            html.replace("style-src 'self'", `style-src 'self' 'nonce-${DEVELOPMENT_CSP_NONCE}'`),
        },
      },
      devtools(),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolve(__dirname, '../web/src/routes'),
        generatedRouteTree: resolve(__dirname, '../web/src/routeTree.gen.ts'),
      }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
  };
});

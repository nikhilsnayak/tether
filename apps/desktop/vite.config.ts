import { resolve } from 'node:path';

import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The renderer is the web app's source, so it mirrors apps/web/vite.config.ts:
// the same React + compiler + Tailwind pipeline, plus the `@` alias the web
// code resolves via tsconfig paths. `base: './'` keeps asset URLs relative so
// the production bundle loads over file:// inside Electron. The signaling
// server URL comes from the reused web app-client (deployed by default,
// overridable with VITE_SERVER_URL via apps/desktop/.env).
export default defineConfig(async () => {
  const { devtools } = await import('@tanstack/devtools-vite');

  return {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'build'),
    base: './',
    envDir: __dirname,
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
    plugins: [devtools(), react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  };
});

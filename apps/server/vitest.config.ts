import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Composition roots (DI wiring) carry no logic worth unit-testing.
      exclude: ['src/index.ts', 'src/App.ts', 'src/Rpc.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});

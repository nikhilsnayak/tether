import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    coverage: {
      provider: 'v8',
      // Unit tests target core logic; UI (.tsx components/screens, React hooks)
      // and composition roots (DI wiring, constants) are excluded.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/hooks/**',
        'src/lib/app-client.ts',
        'src/lib/runtime.ts',
        'src/lib/theme.ts',
        'src/modules/room/peer-session/runtime.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});

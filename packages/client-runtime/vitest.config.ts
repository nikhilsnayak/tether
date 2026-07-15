import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Composition roots (DI wiring) carry no logic worth unit-testing.
      exclude: [
        'src/**/test/**',
        'src/**/index.ts',
        'src/AppClient.ts',
        // Type-only domain models and Effect service interfaces have no
        // executable behavior for V8 to measure.
        'src/**/Model.ts',
        'src/**/ActorModel.ts',
        'src/**/Services.ts',
        // Wires AppClient, platform services, scopes, and the actor together;
        // protocol translation is covered independently by Translation.test.ts.
        'src/modules/room/PeerSessionHost.ts',
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

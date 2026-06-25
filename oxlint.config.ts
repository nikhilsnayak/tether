import { defineConfig } from 'oxlint';

export default defineConfig({
  ignorePatterns: ['**/routeTree.gen.ts', 'repos/**'],
  plugins: [
    'eslint',
    'typescript',
    'unicorn',
    'react',
    'react-perf',
    'oxc',
    'import',
    'jsx-a11y',
    'promise',
    'node',
  ],
  options: {
    typeAware: true,
    typeCheck: true,
  },
});

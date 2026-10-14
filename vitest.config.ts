import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
  },
  // tsconfig sets jsx: "preserve" (Next runs its own JSX transform), which the
  // bundler can't parse during test import analysis. Force the automatic JSX
  // runtime for the test transform so vitest can import server components that
  // contain JSX (e.g. page.tsx).
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Apollo loads the CJS GraphQL entry. Use the same instance in tests
      // that inspect its schema (the package also ships a separate ESM entry).
      graphql: path.resolve(__dirname, './node_modules/graphql/index.js'),
    },
  },
});

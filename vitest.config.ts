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
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['repo-to-analyze/**', 'node_modules/**'],
  },
});

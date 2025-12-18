import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['node_modules', '.next', 'convex/_generated'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/dj/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/types.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});

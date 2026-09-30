import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@omnysync/contracts': path.resolve(__dirname, './packages/contracts/src/index.ts'),
      '@omnysync/financial-engine': path.resolve(__dirname, './packages/financial-engine/src/index.ts'),
      '@omnysync/platform': path.resolve(__dirname, './packages/platform/src/index.ts'),
      '@omnysync/ui': path.resolve(__dirname, './packages/ui/src/index.ts'),
    },
  },
});

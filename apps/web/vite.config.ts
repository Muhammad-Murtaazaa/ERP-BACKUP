import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@omnysync/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
      '@omnysync/financial-engine': path.resolve(__dirname, '../../packages/financial-engine/src'),
      '@omnysync/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
});

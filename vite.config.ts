import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api/entur': {
        target: 'https://api.entur.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/entur/, ''),
      },
    },
  },
  preview: {
    proxy: {
      '/api/entur': {
        target: 'https://api.entur.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/entur/, ''),
      },
    },
  },
});

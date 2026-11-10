import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the production build can be served from any static path.
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});

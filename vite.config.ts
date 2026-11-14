import { defineConfig } from 'vite';

// Ассеты лежат в assets/ и отдаются как статика: assets/tiny-swords/... → /tiny-swords/...
export default defineConfig({
  base: './',
  publicDir: 'assets',
  server: { port: 5173, open: false },
  build: { chunkSizeWarningLimit: 2000 },
});

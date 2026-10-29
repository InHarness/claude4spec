import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/client'),
  build: {
    outDir: path.resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
  },
  server: {
    middlewareMode: true,
  },
  optimizeDeps: {
    // gray-matter is loaded via runtime import(); pin it so Vite's dep optimizer
    // bundles it in the first pass instead of re-optimizing mid-session (which
    // produces "chunk-XXXX.js does not exist" warnings + full reloads).
    include: ['gray-matter'],
  },
  appType: 'custom',
});

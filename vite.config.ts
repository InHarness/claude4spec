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
    // mermaid + gray-matter are loaded via runtime import(); pin them so Vite's dep
    // optimizer bundles them in the first pass instead of re-optimizing mid-session
    // (which produces "chunk-XXXX.js does not exist" warnings + full reloads).
    include: ['mermaid', 'gray-matter'],
  },
  appType: 'custom',
});

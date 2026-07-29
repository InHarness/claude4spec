import { defineConfig } from 'vite';

/**
 * Vite library mode, two entries: `src/index.ts` (backend, imported by the host
 * loader) and `src/frontend.tsx` (browser, fetched as native ESM through the
 * host's plugin-asset route).
 *
 * Everything the host provides stays EXTERNAL. React, Tiptap and TanStack must
 * be external because two copies break hooks and split the router's route tree;
 * the browser receives the host's singletons through its import map.
 *
 * `express` / `zod` / `better-sqlite3` are external too, which differs from the
 * external-plugin scaffold. A scaffolded plugin bundles its backend deps with a
 * second esbuild pass, because a project-local plugin is loaded from a mounted
 * directory the host never ran `npm install` against. An envelope is not: it
 * lives inside the host package, so Node resolution walks up to the host's own
 * `node_modules` in development AND in an npm install. Extracting this package
 * to its own repo is where that pass gets added.
 */
const EXTERNAL = [
  '@c4s/plugin-runtime',
  '@c4s/plugin-runtime/ui',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@tiptap/core',
  '@tanstack/react-query',
  '@tanstack/react-router',
  'lucide-react',
  'express',
  'better-sqlite3',
  'zod',
];

export default defineConfig({
  // Pin the stable automatic JSX runtime. Vite defaults `jsxDev` to
  // `!isProduction`, which can be true even under `vite build` if NODE_ENV says
  // development — and the host's production React ships `jsxDEV` as a no-op
  // stub, so those calls would throw and take the whole plugin frontend down.
  esbuild: { jsxDev: false },
  build: {
    lib: {
      entry: { index: 'src/index.ts', frontend: 'src/frontend.tsx' },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: (id) => EXTERNAL.includes(id) || id.startsWith('@tiptap/') || id.startsWith('node:'),
    },
    // Never minify: the loader reads the named `manifest` export off this module.
    minify: false,
    sourcemap: true,
    target: 'es2022',
    emptyOutDir: true,
  },
});

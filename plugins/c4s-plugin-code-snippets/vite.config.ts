import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Vite library mode, two entries: `src/index.ts` (backend, imported by the host
 * loader) and `src/frontend.tsx` (browser, fetched as native ESM through the
 * host's plugin-asset route). Same shape as the `api-contracts` envelope beside
 * it, and deliberately so — the two must not drift.
 *
 * Everything the host provides stays EXTERNAL. React, Tiptap and TanStack must
 * be external because two copies break hooks and split the router's route tree;
 * the browser receives the host's singletons through its import map.
 *
 * OUTPUT GOES INTO THE HOST'S `dist/`, not into a `dist/` beside this source.
 *
 * That is the one deviation from the scaffold layout, and it is not cosmetic:
 * every mechanism that packages this host copies `dist/` and only `dist/`. An
 * artifact anywhere else is silently absent at runtime — `discoverBuiltinEnvelopes()`
 * returns `[]`, no error, and the host simply has no `mcp-tool`.
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

const OUT_DIR = path.resolve(import.meta.dirname, '../../dist/plugins/c4s-plugin-code-snippets');

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
      /**
       * `frontend.css`, NOT the default `<lib-name>.css`.
       *
       * The host serves a plugin's stylesheet from exactly one filename beside
       * its bundle (`frontendAssetPath` / `hasCss` in `frontend-assets.ts`), and
       * the frontend manifest advertises the sheet only when a file with that
       * name exists. Vite's default name is derived from the package, so the
       * emitted CSS would sit unreferenced next to the bundle — the plugin would
       * load, render, and be styled by nothing but the host's own typography.
       */
      cssFileName: 'frontend',
    },
    rollupOptions: {
      external: (id) => EXTERNAL.includes(id) || id.startsWith('@tiptap/') || id.startsWith('node:'),
    },
    // Never minify: the loader reads the named `manifest` export off this module.
    minify: false,
    sourcemap: true,
    target: 'es2022',
    outDir: OUT_DIR,
    // Outside the package root, so vite needs telling that emptying is intended.
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'c4s-envelope-manifest',
      /**
       * The loader resolves an envelope's entry through its `package.json`
       * (`exports` → `main`), so a manifest has to sit beside the bundles it
       * points at. It is REWRITTEN rather than copied: the source manifest's
       * paths carry a `dist/` segment that is already consumed by the output
       * directory, and a copied one would send the loader to
       * `dist/plugins/<name>/dist/index.js`.
       */
      closeBundle() {
        const src = JSON.parse(
          readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8'),
        ) as { name: string; version: string; description?: string };
        const flattened = {
          name: src.name,
          version: src.version,
          description: src.description,
          type: 'module',
          exports: {
            '.': { import: './index.js', default: './index.js' },
            './frontend': { import: './frontend.js', default: './frontend.js' },
          },
          main: './index.js',
        };
        mkdirSync(OUT_DIR, { recursive: true });
        writeFileSync(path.join(OUT_DIR, 'package.json'), `${JSON.stringify(flattened, null, 2)}\n`);
      },
    },
  ],
});

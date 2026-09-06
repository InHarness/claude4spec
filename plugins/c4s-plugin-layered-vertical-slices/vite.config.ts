import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Vite library mode, two entries since 0.2.70: `src/index.ts` (backend, imported
 * by the host loader) and `src/frontend.tsx` (browser, fetched as native ESM
 * through the host's plugin-asset route).
 *
 * The second entry is NEW, and its arrival is this release seen from the build.
 * Until now there was one entry and no `frontend.tsx` beside it — not an
 * omission but a consequence: the envelope contributed no entity type, so it had
 * nothing to render. Contributing `module-dependency` gives it three render
 * slots, and the host discovers a plugin's frontend bundle by file existence, so
 * the file IS the declaration.
 *
 * Everything the host provides stays EXTERNAL. React must be external because
 * two copies break hooks; the browser receives the host's singletons through its
 * import map.
 *
 * OUTPUT GOES INTO THE HOST'S `dist/`, not into a `dist/` beside this source.
 *
 * Same reasoning as every other envelope: every mechanism that packages this
 * host copies `dist/` and only `dist/`. An artifact anywhere else is silently
 * absent at runtime — `discoverBuiltinEnvelopes()` returns `[]`, no error, and
 * the host simply has no `layered-vertical-slices` style and no
 * `module-dependency` type.
 *
 * The `?raw` imports in `src/skills/` are what makes the style's package travel
 * as LITERALS compiled into this module: Vite inlines each `.md` file's text at
 * build time, so the registry serves `SKILL.md` and every sub-file from memory
 * and never reads the disk. The markdown stays as real files here so it remains
 * reviewable and diffable against the history it was moved from.
 */
const EXTERNAL = [
  '@c4s/plugin-runtime',
  '@c4s/plugin-runtime/ui',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'lucide-react',
];

const OUT_DIR = path.resolve(
  import.meta.dirname,
  '../../dist/plugins/c4s-plugin-layered-vertical-slices',
);

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
       * emitted CSS would sit unreferenced next to the bundle.
       */
      cssFileName: 'frontend',
    },
    rollupOptions: {
      external: (id) => EXTERNAL.includes(id) || id.startsWith('node:'),
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

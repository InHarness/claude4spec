import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Vite library mode with ONE entry, `src/index.ts`. There is no `frontend.tsx`
 * beside it and that is not an omission: this envelope contributes no entity
 * type, so it has nothing to render. The host discovers a plugin's frontend
 * bundle by file existence, so its absence simply means "no frontend entry" —
 * no declaration is needed anywhere to say so.
 *
 * OUTPUT GOES INTO THE HOST'S `dist/`, not into a `dist/` beside this source.
 *
 * Same reasoning as every other envelope: every mechanism that packages this
 * host copies `dist/` and only `dist/`. An artifact anywhere else is silently
 * absent at runtime — `discoverBuiltinEnvelopes()` returns `[]`, no error, and
 * the host simply has no `layered-vertical-slices` style.
 *
 * The `?raw` imports in `src/skills/` are what makes the style's package travel
 * as LITERALS compiled into this module: Vite inlines each `.md` file's text at
 * build time, so the registry serves `SKILL.md` and every sub-file from memory
 * and never reads the disk. The markdown stays as real files here so it remains
 * reviewable and diffable against the history it was moved from.
 */
const OUT_DIR = path.resolve(
  import.meta.dirname,
  '../../dist/plugins/c4s-plugin-layered-vertical-slices',
);

export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: (id) => id === '@c4s/plugin-runtime' || id.startsWith('node:'),
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
       * (`exports` → `main`), so a manifest has to sit beside the bundle it
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
          },
          main: './index.js',
        };
        mkdirSync(OUT_DIR, { recursive: true });
        writeFileSync(path.join(OUT_DIR, 'package.json'), `${JSON.stringify(flattened, null, 2)}\n`);
      },
    },
  ],
});

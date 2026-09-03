import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Vite library mode with ONE entry, `src/index.ts`. There is no `frontend.tsx`
 * beside it: this envelope contributes no entity type, so it has nothing to
 * render. The host discovers a plugin's frontend bundle by file existence, so its
 * absence needs no declaration anywhere.
 *
 * OUTPUT GOES INTO THE HOST'S `dist/`, not into a `dist/` beside this source —
 * every mechanism that packages the host copies `dist/` and only `dist/`, so an
 * artifact anywhere else is silently absent at runtime (`discoverBuiltinEnvelopes()`
 * simply does not see it).
 *
 * The `?raw` import in `src/skills/` is what makes the skill travel as LITERALS
 * compiled into this module: Vite inlines the markdown at build time, so the
 * registry serves `SKILL.md` from memory and never reads the disk. That is the one
 * real difference from the FS roots, which resolve a package lazily off disk on
 * every read — and it is the difference that makes this contribution distributable.
 * The markdown stays a real file here so it remains reviewable and diffable against
 * the history it was moved from (`src/server/skills/writing-style-author/SKILL.md`,
 * retired in 0.2.66).
 */
const OUT_DIR = path.resolve(
  import.meta.dirname,
  '../../dist/plugins/c4s-plugin-writing-style-author',
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

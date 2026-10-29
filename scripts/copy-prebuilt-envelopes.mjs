#!/usr/bin/env node
// 2.1.63 (M13 `m13plenv`, M33 L11 `9g96q3pp`) — the build step for PREBUILT
// built-in envelopes.
//
// A prebuilt envelope is committed under `plugins/<name>/` as a ready bundle:
// `package.json` + `dist/`, no `src/` — its source and its build live in the
// plugin's own repository, and this host never builds it. What the host does
// is the one step every envelope built from source gets for free from its vite
// `outDir`: put the bundle where built-in envelopes are loaded from,
// `dist/plugins/<name>/`, so it travels with everything else that ships `dist/`.
// From there discovery cannot tell it from an envelope built from source.
//
// Per prebuilt envelope:
//   - `dist/plugins/<name>/` is emptied first (a stale chunk of an older bundle
//     would otherwise sit beside the new one);
//   - every file of `plugins/<name>/dist/` is copied EXCEPT source maps (`*.map`);
//   - `package.json` is REWRITTEN, not copied: the source manifest's paths carry
//     a `dist/` segment the output directory already consumes, so a copy would
//     send the loader one level too deep. Only what resolves and names the
//     package is kept — the same rule the source-built envelopes' vite plugin
//     applies.
//
// A folder WITH `src/` is an envelope built from source (its own vite build
// emits into `dist/plugins/<name>/`); it is skipped here.
//
// Usage: node scripts/copy-prebuilt-envelopes.mjs [hostRoot]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const PLUGINS = path.join(ROOT, 'plugins');
const OUT = path.join(ROOT, 'dist', 'plugins');

/** `./dist/x.js` → `./x.js`; anything else unchanged. */
function flatten(value) {
  if (typeof value === 'string') return value.replace(/^\.\/dist\//, './');
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, flatten(v)]));
  }
  return value;
}

function copyWithoutMaps(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyWithoutMaps(src, dst);
    else if (entry.isFile() && !entry.name.endsWith('.map')) fs.copyFileSync(src, dst);
  }
}

const copied = [];
let entries = [];
try {
  entries = fs.readdirSync(PLUGINS, { withFileTypes: true });
} catch {
  // No `plugins/` directory — nothing to copy.
}
for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const dir = path.join(PLUGINS, entry.name);
  const pkgPath = path.join(dir, 'package.json');
  const distDir = path.join(dir, 'dist');
  if (fs.existsSync(path.join(dir, 'src')) || !fs.existsSync(pkgPath) || !fs.existsSync(distDir)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const target = path.join(OUT, entry.name);
  fs.rmSync(target, { recursive: true, force: true });
  copyWithoutMaps(distDir, target);
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: pkg.type ?? 'module',
    ...(pkg.exports !== undefined ? { exports: flatten(pkg.exports) } : {}),
    ...(pkg.main !== undefined ? { main: flatten(pkg.main) } : {}),
  };
  fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  copied.push(entry.name);
}

console.log(
  copied.length > 0
    ? `[prebuilt-envelopes] copied ${copied.join(', ')} → dist/plugins/`
    : '[prebuilt-envelopes] no prebuilt envelope under plugins/',
);

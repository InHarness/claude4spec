/**
 * 0.2.2 — tier (b): BUILT-IN ENVELOPES, the third discovery sub-source of the
 * M33 loader (brief item 10).
 *
 * Entity types now register at three tiers:
 *   (a) built-in direct   — `serialization/registerAll.ts` calls
 *                           `registerEntityModule(...)` outright at process start.
 *   (b) built-in envelope — THIS module: a real plugin package living inside the
 *                           host repo under `plugins/<name>/`, discovered and
 *                           registered through the ordinary loader pipeline.
 *   (c) external package  — `node_modules` or a workspace `plugins[]` entry.
 *
 * Why a middle tier exists at all: an envelope is structurally identical to the
 * output of `c4s create-plugin` and imports the host ONLY through
 * `@c4s/plugin-runtime`, so extracting it into its own repository is `git mv` plus
 * a `package.json` — not a rewrite. It is trusted by virtue of living in the host
 * repo, so it sits OUTSIDE the `trustProjectPlugins` gate, which exists solely to
 * gate the project-local overlay under `<cwd>/.claude4spec/plugins/`.
 *
 * ORDER MATTERS: envelopes are registered BEFORE `node_modules` packages and
 * before the workspace registry, so core code registers first and nothing external
 * can shadow a core type by accident. Collision semantics are unchanged — the
 * silent last-wins of `registerEntityModule` — so an external package still *can*
 * deliberately shadow an envelope.
 *
 * M31 orthogonality: an envelope is NOT a workspace-registry entry. `plugins[]`
 * stays a list of npm packages only, not a catalogue of everything the process
 * loads.
 *
 * There are no envelopes in the repo yet — `c4s-plugin-api-contracts` (carrying
 * `endpoint` + `dto`) arrives in Tier B of the 0.2.2 brief. This is the plumbing
 * it lands on, exercised by `builtin-envelopes.test.ts` against a fixture.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path of the host package root (the directory holding the host's own
 * `package.json`), walking up from this module.
 *
 * Resolved rather than hardcoded so it works identically from `src/` in dev and
 * from `dist/` in an installed package — the same reason `db/migrate.ts` resolves
 * its migrations directory from `import.meta.url`.
 */
export function hostPackageRoot(from: string = __dirname): string | null {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** One discovered envelope: its directory name and the ESM specifier to import. */
export interface BuiltinEnvelope {
  /** Directory name under `plugins/`, used as the load record's `package` id. */
  name: string;
  /** Absolute path of the envelope package directory. */
  dir: string;
  /** `file://` URL of the entry module, ready for `import()`. */
  specifier: string;
}

/**
 * Read an envelope's entry point from its own `package.json`, exactly as Node
 * would: `exports["."]` (string, or its `import`/`default` condition) first, then
 * `main`, then the `src/index.js` default that matches the `c4s create-plugin`
 * layout.
 */
function resolveEnvelopeEntry(dir: string): string | null {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  const candidates: Array<string | undefined> = [];
  const exp = pkg.exports as unknown;
  if (typeof exp === 'string') {
    candidates.push(exp);
  } else if (exp && typeof exp === 'object') {
    const dot = (exp as Record<string, unknown>)['.'] ?? exp;
    if (typeof dot === 'string') {
      candidates.push(dot);
    } else if (dot && typeof dot === 'object') {
      const cond = dot as Record<string, unknown>;
      for (const key of ['import', 'default', 'node']) {
        if (typeof cond[key] === 'string') candidates.push(cond[key] as string);
      }
    }
  }
  if (typeof pkg.main === 'string') candidates.push(pkg.main);
  candidates.push('src/index.js', 'dist/index.js');

  for (const rel of candidates) {
    if (!rel) continue;
    const abs = path.resolve(dir, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/**
 * Discover built-in envelopes under `<hostRoot>/plugins/*`.
 *
 * Returns `[]` — never throws — when the directory is absent, which is the normal
 * state until Tier B adds the first envelope. Results are sorted by directory name
 * so registration order is deterministic across filesystems.
 */
export function discoverBuiltinEnvelopes(root: string | null = hostPackageRoot()): BuiltinEnvelope[] {
  if (!root) return [];
  const pluginsDir = path.join(root, 'plugins');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return []; // no plugins/ directory — nothing to discover
  }

  const out: BuiltinEnvelope[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(pluginsDir, entry.name);
    const abs = resolveEnvelopeEntry(dir);
    if (!abs) {
      console.warn(
        `[plugin-loader] built-in envelope '${entry.name}' has no resolvable entry ` +
          `(checked package.json exports/main, then src/index.js) — skipping`,
      );
      continue;
    }
    out.push({ name: entry.name, dir, specifier: pathToFileURL(abs).href });
  }
  return out;
}

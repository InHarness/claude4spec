/**
 * M33 / M31 `vzkw903j` (2.1.58) — where the base tier's packages live and how
 * one of them is resolved.
 *
 * The package list comes from the workspace view (`plugins[]`, from the
 * committed `workspace.json` in a workspace with a home, from the registry
 * entry otherwise — M31 `dojs7m3h`). The packages themselves live in ONE
 * directory: `node_modules` of the workspace's slots directory
 * (`~/.claude4spec/<workspace>/node_modules`, `<home>/.claude4spec/local/node_modules`).
 * They are installed there by the user (`npm install` in that directory) —
 * never by the server: nothing in this module (or anywhere in the loader)
 * spawns a package manager.
 *
 * One locator answers every question the base tier asks about a listed
 * package, so the three readers cannot drift (`m33l2001` "Spójność resolucji
 * load↔watch", L7 `m33l7wch` invariant, L11 `9g96q3pp` discovery):
 *
 *   • is it installed?        — the loader skips a missing one with a diagnosis;
 *   • its ESM main entry      — the file the loader `import()`s AND the file
 *                               whose directory the `plugins:base` mount watches;
 *   • its package root        — where the frontend entry rule is applied.
 *
 * The main entry is resolved with the ESM conditions (`node`, `import`,
 * `default` — never `require`), counted from the workspace `node_modules`
 * alone: no walk up to a parent `node_modules`, no fallback to the host's own
 * dependencies. Because the loader imports the very file this resolution
 * returns, load and watch share the resolution by construction. The resolution
 * is a pure filesystem read, so it behaves identically in the production
 * runtime and in a test runner (which cannot run `import.meta.resolve`).
 *
 * Predefined packages (sub-source (ii), shipped in the distribution's
 * `node_modules`) are not in the workspace directory: they resolve with the
 * host's own ESM resolution (`resolveBaseEntry`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveBaseEntry } from './loader.js';

/** The workspace's plugin package directory: `node_modules` of its slots directory. */
export function workspaceNodeModulesDir(slotsDir: string): string {
  return path.join(slotsDir, 'node_modules');
}

/** An npm package name (optionally scoped) — anything else could escape the directory. */
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

/** The ESM conditions a bare `import()` matches in Node, in addition to `default`. */
const ESM_CONDITIONS: ReadonlySet<string> = new Set(['node', 'import', 'default']);

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A conditional / array / string export target → its `./`-relative path, or null. */
function resolveTarget(target: unknown): string | null {
  if (typeof target === 'string') return target.startsWith('./') ? target : null;
  if (Array.isArray(target)) {
    for (const t of target) {
      const hit = resolveTarget(t);
      if (hit) return hit;
    }
    return null;
  }
  if (target && typeof target === 'object') {
    for (const [condition, value] of Object.entries(target)) {
      if (!ESM_CONDITIONS.has(condition)) continue;
      const hit = resolveTarget(value);
      if (hit) return hit;
    }
  }
  return null;
}

/** The `.` export of an `exports` field (sugar: a string, an array or a conditions-only object). */
function mainExport(exports: unknown): unknown {
  if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
    const keys = Object.keys(exports);
    if (keys.some((k) => k.startsWith('.'))) return (exports as Record<string, unknown>)['.'];
  }
  return exports;
}

/** `rel` inside `root` as an existing file, or null (never outside `root`). */
function fileWithin(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) return null;
  try {
    return fs.statSync(abs).isFile() ? abs : null;
  } catch {
    return null;
  }
}

/**
 * The ESM main entry of the package rooted at `packageDir`, as an absolute
 * path, or null. With `exports`: the `.` target under the `node` / `import` /
 * `default` conditions (an ESM-only `{ import }` package resolves; a
 * `require`-only one does not). Without `exports`: `main` (as is, `.js`,
 * `/index.js`), then `index.js`.
 */
export function resolveEsmPackageEntry(packageDir: string): string | null {
  const pkg = readJson(path.join(packageDir, 'package.json'));
  if (!pkg) return null;
  if (pkg.exports !== undefined) {
    const rel = resolveTarget(mainExport(pkg.exports));
    return rel ? fileWithin(packageDir, rel) : null;
  }
  const main = typeof pkg.main === 'string' && pkg.main.length > 0 ? pkg.main : null;
  const candidates = main ? [main, `${main}.js`, path.join(main, 'index.js')] : [];
  for (const rel of [...candidates, 'index.js']) {
    const hit = fileWithin(packageDir, rel);
    if (hit) return hit;
  }
  return null;
}

/** The single answer of the base tier about where a listed package is and what it loads. */
export interface BasePackageLocator {
  /** The workspace package directory (named by the not-installed diagnosis). */
  readonly nodeModulesDir: string;
  /** Is the package present where it must be installed? */
  isInstalled(pkg: string): boolean;
  /** Its ESM main entry (absolute path) — what is imported and what is watched — or null. */
  resolveEntry(pkg: string): string | null;
  /** Its package root (where `package.json` lives), or null when not installed. */
  packageRoot(pkg: string): string | null;
}

/**
 * The locator of one workspace: a listed package resolves in
 * `nodeModulesDir` only; a `predefined` one with the host's own resolution.
 */
export function basePackageLocator(
  nodeModulesDir: string,
  predefined: readonly string[] = [],
): BasePackageLocator {
  const isPredefined = new Set(predefined);
  const workspaceRoot = (pkg: string): string | null => {
    if (!PACKAGE_NAME.test(pkg)) return null;
    const dir = path.join(nodeModulesDir, ...pkg.split('/'));
    return fs.existsSync(path.join(dir, 'package.json')) ? dir : null;
  };
  const resolveEntry = (pkg: string): string | null => {
    if (isPredefined.has(pkg)) return resolveBaseEntry(pkg);
    const root = workspaceRoot(pkg);
    return root ? resolveEsmPackageEntry(root) : null;
  };
  return {
    nodeModulesDir,
    isInstalled: (pkg) => (isPredefined.has(pkg) ? resolveBaseEntry(pkg) !== null : workspaceRoot(pkg) !== null),
    resolveEntry,
    packageRoot: (pkg) => {
      if (!isPredefined.has(pkg)) return workspaceRoot(pkg);
      const entry = resolveBaseEntry(pkg);
      return entry ? nearestPackageRoot(path.dirname(entry)) : null;
    },
  };
}

/**
 * Walk up from `startDir` to the nearest ancestor owning a readable
 * `package.json` (a predefined package's root, found from its resolved entry),
 * or null within 12 levels. The `name` is deliberately not checked: the
 * resolution already proved identity.
 */
export function nearestPackageRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (readJson(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * M33 — plugin frontend sources, assets and the effective pool (2.1.20).
 *
 * The serving layer for "Option B" plugin frontends. This express-free module
 * owns the one rule the manifest builder (`frontend-manifest.ts`) and the asset
 * route (`routes/plugins.ts`, `GET /api/plugins/:name/:asset`) share, so the two
 * cannot diverge (L11 `9g96q3pp`):
 *
 *   • Three sources. A project-local OVERLAY (`<cwd>/.claude4spec/plugins/<folder>/`,
 *     behind `trustProjectPlugins`), an NPM PACKAGE of the workspace (ungated — a
 *     consciously installed package is trusted) and a BUILT-IN ENVELOPE (ungated —
 *     it lives in the host repo).
 *   • Entry rule. The overlay's entry is always the fixed `dist/frontend.js` (its
 *     `exports` are not read); a package's and an envelope's entry is
 *     `exports['./frontend']` (conditions `import` → `module` → `default` → `node`
 *     → `require`), falling back to `dist/frontend.js`. CSS is `frontend.css` next
 *     to the resolved entry. Name and version: the overlay's folder name + its
 *     `package.json` version; a package's / envelope's own `package.json`.
 *   • Manifest filter. A source is admitted only when its BACKEND has status
 *     `loaded` after the `hostApiVersion` / `engines` gate — one rule for all three
 *     sources. A package without a backend entry never reaches `loaded`, so it
 *     never announces a frontend (no frontend-only plugins).
 *   • Precedence on a name collision: overlay over npm package over envelope.
 *
 * The host does NOT inspect a bundle's contents: a plugin that bundled its own
 * React or Tiptap is announced and served like any other (the starter template's
 * `external` list is the protection, not a load-time check — `m33l5imp`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  enumerateOverlayPackages,
  projectPluginsDir,
  resolveExportsEntry,
} from './overlay-loader.js';
import type { BuiltinEnvelope } from './builtin-envelopes.js';

/** The `package.json` fields the asset resolvers read. */
interface PackageManifest {
  name?: unknown;
  version?: unknown;
  exports?: unknown;
}

/** Read + parse a `package.json`, or `null` when missing/unreadable/invalid. */
function readPackageJson(pkgJsonPath: string): PackageManifest | null {
  try {
    return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
}

/** A manifest's declared `version`, falling back to `'0.0.0'`. */
function packageVersion(pkg: PackageManifest | null): string {
  return pkg && typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

/**
 * Walk up from `startDir` to the NEAREST ancestor that owns a readable
 * `package.json` — the package root — or `null` if none within 12 levels. The
 * caller has already proved the package's identity (`import.meta.resolve`
 * resolved a DECLARED subpath of `packageName`), so we deliberately do NOT gate
 * on the manifest `name`: a workspace plugin whose install/dir name differs from
 * its real (e.g. scoped) `package.json` `name` must still resolve to its root.
 * The 12-level bound is a cheap runaway guard for a pathological deep tree.
 */
export function nearestPackageRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (readPackageJson(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── Workspace tier (phase 3) ───────────────────────────────────────────────

/** Resolve an installed workspace plugin package's absolute root dir, or null. */
export type WorkspaceRootResolver = (packageName: string) => string | null;

/**
 * Default resolver. Two reasons `createRequire(...).resolve` is wrong here:
 *   1. `require.resolve('<pkg>/package.json')` — a package with an `exports` map
 *      blocks undeclared subpaths like `./package.json`; and
 *   2. `require.resolve` uses CJS conditions (`require`/`node`/`default`), but a
 *      modern plugin's `exports` is import-only (`{ types, import }`) ⇒ "No
 *      exports main defined".
 * So resolve a DECLARED ESM subpath with `import.meta.resolve` (which uses the
 * `import` condition) — that resolution alone PROVES identity — then walk up to
 * the nearest directory owning a `package.json` (the package root) via
 * `nearestPackageRoot`. We do NOT re-check that `package.json`'s `name` equals
 * the requested id: a plugin installed under an unscoped dir name whose real
 * `name` is scoped (`@scope/pkg`) would otherwise never match and silently lose
 * its frontend. Try `./frontend` first (the only subpath we serve), then `.`.
 */
const defaultWorkspaceRoot: WorkspaceRootResolver = (packageName) => {
  let entryUrl: string | undefined;
  for (const spec of [`${packageName}/frontend`, packageName]) {
    try {
      entryUrl = import.meta.resolve(spec);
      break;
    } catch {
      /* try the next entry specifier */
    }
  }
  if (!entryUrl) return null;
  return nearestPackageRoot(path.dirname(fileURLToPath(entryUrl)));
};


// ─── Sources ────────────────────────────────────────────────────────────────

/** Which of the three sources contributed a frontend. */
export type FrontendSourceKind = 'overlay' | 'npm' | 'envelope';

/** One plugin frontend, as resolved from one source. */
export interface FrontendSource {
  kind: FrontendSourceKind;
  /** The plugin name the manifest announces and the asset route is addressed by. */
  name: string;
  /** Package version (cache-bust key of the entry URL), `'0.0.0'` when unreadable. */
  version: string;
  /** Absolute path of the resolved, existing frontend entry. */
  entry: string;
  /** Absolute path of `frontend.css` next to the entry, or null when not shipped. */
  css: string | null;
  /** The load-record id whose backend status admits this source (`PluginLoadRecord.package`). */
  recordKey: string;
}

/** Asset extensions a plugin bundle dir may serve, with their content types. */
const ASSET_CONTENT_TYPE: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

/** Content type for a served asset name, or `null` when the extension is not allowed. */
export function assetContentType(asset: string): string | null {
  return ASSET_CONTENT_TYPE[path.extname(asset).toLowerCase()] ?? null;
}

/**
 * Build a source from a resolved entry path; null when the entry is not built
 * or is not a servable `.js` file (the asset route could never serve it).
 */
function toSource(
  kind: FrontendSourceKind,
  name: string,
  version: string,
  entry: string,
  recordKey: string,
): FrontendSource | null {
  if (assetContentType(entry) !== 'text/javascript') return null;
  if (!fs.existsSync(entry)) return null;
  const css = path.join(path.dirname(entry), 'frontend.css');
  return { kind, name, version, entry, css: fs.existsSync(css) ? css : null, recordKey };
}

/**
 * The npm-package entry rule, relative to a package (or envelope) root:
 * `exports['./frontend']` when declared, else `dist/frontend.js`.
 */
export function packageFrontendEntry(root: string): string {
  const pkg = readPackageJson(path.join(root, 'package.json'));
  const sub = (pkg?.exports as Record<string, unknown> | undefined)?.['./frontend'];
  return path.resolve(root, resolveExportsEntry(sub) ?? 'dist/frontend.js');
}

/** A package's (or envelope's) own name from its `package.json`, else `fallback`. */
function packageName(pkg: PackageManifest | null, fallback: string): string {
  return pkg && typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : fallback;
}

/**
 * Overlay frontends of `cwd` — a pure FS read, no gate: the caller decides trust.
 * The entry is the fixed `dist/frontend.js` of each folder; `exports` are ignored
 * (an overlay is not installed by a package manager).
 */
export function overlayFrontendSources(cwd: string): FrontendSource[] {
  const out: FrontendSource[] = [];
  for (const folder of enumerateOverlayPackages(cwd)) {
    const dir = path.join(projectPluginsDir(cwd), folder);
    const version = packageVersion(readPackageJson(path.join(dir, 'package.json')));
    const src = toSource('overlay', folder, version, path.join(dir, 'dist', 'frontend.js'), folder);
    if (src) out.push(src);
  }
  return out;
}

/** The frontend of one workspace npm package (`listed` = its name in the workspace list). */
export function npmFrontendSource(
  listed: string,
  resolveRoot: WorkspaceRootResolver = defaultWorkspaceRoot,
): FrontendSource | null {
  const root = resolveRoot(listed);
  if (!root) return null;
  const pkg = readPackageJson(path.join(root, 'package.json'));
  return toSource('npm', packageName(pkg, listed), packageVersion(pkg), packageFrontendEntry(root), listed);
}

/** The frontend of one built-in envelope — the npm rule, relative to its folder. */
export function envelopeFrontendSource(envelope: BuiltinEnvelope): FrontendSource | null {
  const pkg = readPackageJson(path.join(envelope.dir, 'package.json'));
  return toSource(
    'envelope',
    packageName(pkg, envelope.name),
    packageVersion(pkg),
    packageFrontendEntry(envelope.dir),
    envelope.name,
  );
}

// ─── The effective pool ─────────────────────────────────────────────────────

/**
 * Everything the effective frontend pool is computed from. Each `loaded` set holds
 * the load-record ids (`PluginLoadRecord.package`) whose backend is `loaded`.
 */
export interface FrontendPool {
  /** The primary project's overlay. Absent on a workspace-only start. */
  overlay?: { cwd: string; trusted: boolean; loaded: ReadonlySet<string> };
  /** Workspace npm packages (the resolved list `loadWorkspacePlugins` consumed). */
  npm?: { packages: readonly string[]; loaded: ReadonlySet<string>; resolveRoot?: WorkspaceRootResolver };
  /** Built-in envelopes discovered under `<hostRoot>/plugins/`. */
  envelopes?: { list: readonly BuiltinEnvelope[]; loaded: ReadonlySet<string> };
}

/** The `loaded` ids of a list of load records. */
export function loadedRecordKeys(records: ReadonlyArray<{ package: string; status: string }>): Set<string> {
  return new Set(records.filter((r) => r.status === 'loaded').map((r) => r.package));
}

/**
 * The effective pool: one source per plugin name, after the backend-`loaded`
 * filter and the collision precedence (overlay > npm package > envelope). Order:
 * envelopes, then npm packages, then the overlay — a later source replaces an
 * earlier one of the same name in place.
 */
export function effectiveFrontendSources(pool: FrontendPool): FrontendSource[] {
  const byName = new Map<string, FrontendSource>();
  const admit = (src: FrontendSource | null, loaded: ReadonlySet<string>): void => {
    if (src && loaded.has(src.recordKey)) byName.set(src.name, src);
  };
  if (pool.envelopes) {
    for (const e of pool.envelopes.list) admit(envelopeFrontendSource(e), pool.envelopes.loaded);
  }
  if (pool.npm) {
    for (const listed of pool.npm.packages) admit(npmFrontendSource(listed, pool.npm.resolveRoot), pool.npm.loaded);
  }
  if (pool.overlay?.trusted) {
    for (const src of overlayFrontendSources(pool.overlay.cwd)) admit(src, pool.overlay.loaded);
  }
  return [...byName.values()];
}

/**
 * Resolve a single flat `asset` strictly within `dir`. Returns `null` (→ 404) on a
 * disallowed extension, any path separator / `..` in the name, an escape outside
 * `dir`, or a missing file. Vite library output is flat (`frontend.js`,
 * `dto-*.js`, `*.map` beside each other), so a single path-segment name is exactly
 * what a relative ESM import of the entry requests.
 */
function resolveWithinDir(dir: string, asset: string): string | null {
  if (!assetContentType(asset)) return null;
  if (asset.includes('/') || asset.includes('\\') || asset.includes('..')) return null;
  const abs = path.join(dir, asset);
  const rel = path.relative(dir, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return fs.existsSync(abs) ? abs : null;
}

/**
 * `GET /api/plugins/:name/:asset` — the file to stream, or null (→ 404). The
 * source is the one the manifest announces for `name` (same pool, same filter,
 * same precedence); the file must sit in the folder of its resolved entry.
 */
export function resolvePluginAsset(pool: FrontendPool, name: string, asset: string): string | null {
  const src = effectiveFrontendSources(pool).find((s) => s.name === name);
  if (!src) return null;
  return resolveWithinDir(path.dirname(src.entry), asset);
}

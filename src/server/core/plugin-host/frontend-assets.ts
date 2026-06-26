/**
 * M33 — plugin frontend assets, two tiers.
 *
 * The serving layer for "Option B" plugin frontends. This express-free module
 * owns the single path/trust convention shared by the serving route
 * (`routes/plugins.ts`) and the manifest builder (`frontend-manifest.ts`), so
 * the two cannot diverge.
 *
 *   • Overlay tier (phase 2): a TRUSTED project ships a precompiled bundle at
 *     `<cwd>/.claude4spec/plugins/<name>/dist/frontend.js` (+ optional
 *     `frontend.css`). Gated by `trustProjectPlugins` (per workspace × project,
 *     machine-local) — the CALLER resolves the gate and passes `trusted`; an
 *     untrusted/undecided project emits nothing, exactly like the overlay loader
 *     refuses to run untrusted project code.
 *
 *   • Workspace tier (phase 3): a workspace/npm plugin (declared in
 *     `~/.claude4spec/workspaces.json`, installed under `node_modules`) serves
 *     its own `dist/frontend.js` (+ optional `dist/frontend.css`) UNGATED — a
 *     consciously-installed base package is trusted by virtue of npm install,
 *     parity with the backend base tier. Traversal-guarded by the passed
 *     workspace package allowlist (the same list `loadWorkspacePlugins` uses).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  enumerateOverlayPackages,
  projectPluginsDir,
  resolveExportsEntry,
} from './overlay-loader.js';

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

/** The two precompiled assets a plugin frontend bundle may ship. */
export type FrontendAssetFile = 'frontend.js' | 'frontend.css';

/** Absolute path of a plugin's precompiled `dist/<file>`. */
function bundleAssetPath(cwd: string, name: string, file: FrontendAssetFile): string {
  return path.join(projectPluginsDir(cwd), name, 'dist', file);
}

/**
 * Resolve the absolute path to stream for `GET /api/plugins/<name>/<file>`, or
 * `null` when the request must 404. Returns null when:
 *   - the trust gate is off (`!trusted`) — never emit project-committed code,
 *   - `name` is not an actual overlay package — also guards path traversal, as
 *     only directory names enumerated under `.claude4spec/plugins/` are eligible,
 *   - the `dist/<file>` does not exist — a present, trusted project never
 *     fabricates a bundle.
 */
export function resolveFrontendAsset(
  cwd: string,
  trusted: boolean,
  name: string,
  file: FrontendAssetFile,
): string | null {
  if (!trusted) return null;
  if (!enumerateOverlayPackages(cwd).includes(name)) return null;
  const abs = bundleAssetPath(cwd, name, file);
  return fs.existsSync(abs) ? abs : null;
}

/** One plugin (either tier) with a built frontend bundle. */
export interface FrontendBundle {
  /** The manifest `name`: overlay = dir under `.claude4spec/plugins/`; workspace = npm package name. */
  name: string;
  /** Version from the package's `package.json`, or `'0.0.0'` if unreadable. */
  version: string;
  /** True when the bundle also ships a precompiled `dist/frontend.css`. */
  hasCss: boolean;
}

/** Read an overlay package's declared version, falling back to `'0.0.0'`. */
function readBundleVersion(cwd: string, name: string): string {
  return packageVersion(readPackageJson(path.join(projectPluginsDir(cwd), name, 'package.json')));
}

/**
 * Project-local plugins that ship a built `dist/frontend.js`, for the frontend
 * manifest. Pure FS read; the caller gates by trust before calling (an
 * untrusted project advertises nothing). A package without a built bundle is
 * simply omitted — the build is the implementer's responsibility, not the host's.
 */
export function enumerateFrontendBundles(cwd: string): FrontendBundle[] {
  const bundles: FrontendBundle[] = [];
  for (const name of enumerateOverlayPackages(cwd)) {
    if (!fs.existsSync(bundleAssetPath(cwd, name, 'frontend.js'))) continue;
    bundles.push({
      name,
      version: readBundleVersion(cwd, name),
      hasCss: fs.existsSync(bundleAssetPath(cwd, name, 'frontend.css')),
    });
  }
  return bundles;
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

/**
 * The package's declared `./frontend` import target (relative to its root), or
 * the `dist/frontend.js` convention when `exports` does not declare one. Reuses
 * the overlay loader's condition handling so the two tiers can't drift.
 */
function workspaceFrontendEntryRel(pkg: PackageManifest | null): string {
  const sub = (pkg?.exports as Record<string, unknown> | undefined)?.['./frontend'];
  return resolveExportsEntry(sub) ?? 'dist/frontend.js';
}

/** Absolute path of a workspace package's `frontend.js`, given its parsed manifest. */
function workspaceFrontendJs(root: string, pkg: PackageManifest | null): string {
  return path.resolve(root, workspaceFrontendEntryRel(pkg));
}

/**
 * Resolve the absolute path to stream for `GET /api/plugins/<name>/<file>` from a
 * workspace/npm plugin, or `null` when the request must 404. UNGATED (a base
 * install is trusted) — but `packageName` MUST be in `allowedPackages` (the
 * resolved workspace plugin list), which both guards path traversal and bounds
 * serving to actually-declared plugins. The JS path comes from the package's
 * `exports['./frontend']` (fallback `dist/frontend.js`); CSS is its sibling
 * `frontend.css`. Returns null when the package is unresolvable or the file is
 * absent (a plugin without a built bundle simply serves nothing).
 */
export function resolveWorkspaceFrontendAsset(
  packageName: string,
  file: FrontendAssetFile,
  allowedPackages: readonly string[],
  resolveRoot: WorkspaceRootResolver = defaultWorkspaceRoot,
): string | null {
  if (!allowedPackages.includes(packageName)) return null;
  const root = resolveRoot(packageName);
  if (!root) return null;
  const frontendAbs = workspaceFrontendJs(root, readPackageJson(path.join(root, 'package.json')));
  const abs =
    file === 'frontend.js' ? frontendAbs : path.join(path.dirname(frontendAbs), 'frontend.css');
  return fs.existsSync(abs) ? abs : null;
}

/**
 * Workspace/npm plugins that ship a resolvable built `frontend` entry, for the
 * frontend manifest. UNGATED (parity with the backend base tier). A package
 * without a built bundle (or unresolvable) is simply omitted. `resolveRoot` is a
 * test seam — production passes the default `import.meta.resolve`-based resolver.
 *
 * `packageNames` is the resolved workspace allowlist, so every name is trusted by
 * construction (the traversal guard in `resolveWorkspaceFrontendAsset` exists for
 * the user-supplied route `:name`). Each package is resolved + its `package.json`
 * read exactly ONCE here (this runs per `GET /frontend-manifest`).
 */
export function enumerateWorkspaceFrontendBundles(
  packageNames: readonly string[],
  resolveRoot: WorkspaceRootResolver = defaultWorkspaceRoot,
): FrontendBundle[] {
  const bundles: FrontendBundle[] = [];
  for (const name of packageNames) {
    const root = resolveRoot(name);
    if (!root) continue;
    const pkg = readPackageJson(path.join(root, 'package.json'));
    const frontendAbs = workspaceFrontendJs(root, pkg);
    if (!fs.existsSync(frontendAbs)) continue;
    bundles.push({
      name,
      version: packageVersion(pkg),
      hasCss: fs.existsSync(path.join(path.dirname(frontendAbs), 'frontend.css')),
    });
  }
  return bundles;
}

// ─── Generalized dist asset serving (native-ESM siblings) ───────────────────
//
// A plugin's `frontend.js` is served as native ESM (m33l5fe0 — the host does NOT
// re-bundle), so its RELATIVE imports resolve against the module URL: a code-split
// chunk `./dto-*.js` becomes `GET /api/plugins/<name>/dto-*.js`. Serving only
// `frontend.js`/`frontend.css` (the original two-file enum) left those siblings
// 404 and broke any code-split bundle (the first real plugin tripped on it). So
// the host serves any allowlisted asset that physically sits next to the entry,
// strictly contained in the bundle dir, under the SAME trust gating as the entry.

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
 * Resolve a single flat `asset` strictly within `distDir`. Returns `null` (→ 404)
 * on a disallowed extension, any path separator / traversal in the name, an
 * escape outside `distDir`, or a missing file. Vite library output is flat
 * (`frontend.js`, `dto-*.js`, `*.map` all in the bundle root), so a single
 * path-segment name with no separators is exactly what a relative ESM import
 * requests — and rejecting separators is the simplest sound traversal guard.
 */
function resolveWithinDist(distDir: string, asset: string): string | null {
  if (!assetContentType(asset)) return null;
  if (asset.includes('/') || asset.includes('\\') || asset.includes('..')) return null;
  const abs = path.join(distDir, asset);
  const rel = path.relative(distDir, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return fs.existsSync(abs) ? abs : null;
}

/**
 * Overlay tier (trust-gated): resolve any allowlisted sibling of the project-local
 * bundle at `<cwd>/.claude4spec/plugins/<name>/dist/<asset>`. Same gate + package
 * guard as `resolveFrontendAsset`, generalized from the two fixed filenames.
 */
export function resolveOverlayAsset(
  cwd: string,
  trusted: boolean,
  name: string,
  asset: string,
): string | null {
  if (!trusted) return null;
  if (!enumerateOverlayPackages(cwd).includes(name)) return null;
  return resolveWithinDist(path.join(projectPluginsDir(cwd), name, 'dist'), asset);
}

/**
 * Workspace tier (ungated, allowlist-bounded): resolve any allowlisted sibling of
 * a workspace/npm plugin's resolved `frontend` entry (i.e. files in the same
 * `dist/` dir). Generalizes `resolveWorkspaceFrontendAsset` from the two fixed
 * filenames so code-split chunks (`dto-*.js`) and source maps resolve.
 */
export function resolveWorkspaceAsset(
  packageName: string,
  asset: string,
  allowedPackages: readonly string[],
  resolveRoot: WorkspaceRootResolver = defaultWorkspaceRoot,
): string | null {
  if (!allowedPackages.includes(packageName)) return null;
  const root = resolveRoot(packageName);
  if (!root) return null;
  const frontendAbs = workspaceFrontendJs(root, readPackageJson(path.join(root, 'package.json')));
  return resolveWithinDist(path.dirname(frontendAbs), asset);
}

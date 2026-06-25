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
import { enumerateOverlayPackages, projectPluginsDir } from './overlay-loader.js';

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

/** Read a package's declared version, falling back to `'0.0.0'`. */
function readBundleVersion(cwd: string, name: string): string {
  try {
    const pkgJson = path.join(projectPluginsDir(cwd), name, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
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
 * `import` condition), then walk up to the directory owning the matching
 * `package.json`. Try `./frontend` first (the only subpath we serve), then `.`.
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
  let dir = path.dirname(fileURLToPath(entryUrl));
  for (let i = 0; i < 12; i++) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      try {
        const name = (JSON.parse(fs.readFileSync(pj, 'utf8')) as { name?: unknown }).name;
        if (name === packageName) return dir;
      } catch {
        /* unreadable package.json — keep walking up */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
};

/** First string target of a package.json `exports` subpath (conditions object or bare string). */
function pickConditionTarget(node: unknown): string | undefined {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return undefined;
  const cond = node as Record<string, unknown>;
  for (const key of ['import', 'module', 'default']) {
    if (typeof cond[key] === 'string') return cond[key] as string;
  }
  return undefined;
}

/**
 * The package's declared `./frontend` import target, relative to its root, or
 * the `dist/frontend.js` convention when `exports` does not declare one.
 */
function workspaceFrontendEntryRel(pkgRoot: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as {
      exports?: unknown;
    };
    const sub = (pkg.exports as Record<string, unknown> | undefined)?.['./frontend'];
    const rel = pickConditionTarget(sub);
    if (rel) return rel;
  } catch {
    /* fall through to the convention */
  }
  return 'dist/frontend.js';
}

/** Read an installed workspace package's declared version, falling back to `'0.0.0'`. */
function readWorkspaceBundleVersion(pkgRoot: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
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
  const frontendAbs = path.resolve(root, workspaceFrontendEntryRel(root));
  const abs =
    file === 'frontend.js' ? frontendAbs : path.join(path.dirname(frontendAbs), 'frontend.css');
  return fs.existsSync(abs) ? abs : null;
}

/**
 * Workspace/npm plugins that ship a resolvable built `frontend` entry, for the
 * frontend manifest. UNGATED (parity with the backend base tier). A package
 * without a built bundle (or unresolvable) is simply omitted. `resolveRoot` is a
 * test seam — production passes the default `createRequire`-based resolver.
 */
export function enumerateWorkspaceFrontendBundles(
  packageNames: readonly string[],
  resolveRoot: WorkspaceRootResolver = defaultWorkspaceRoot,
): FrontendBundle[] {
  const bundles: FrontendBundle[] = [];
  for (const name of packageNames) {
    if (!resolveWorkspaceFrontendAsset(name, 'frontend.js', packageNames, resolveRoot)) continue;
    const root = resolveRoot(name);
    bundles.push({
      name,
      version: root ? readWorkspaceBundleVersion(root) : '0.0.0',
      hasCss: resolveWorkspaceFrontendAsset(name, 'frontend.css', packageNames, resolveRoot) != null,
    });
  }
  return bundles;
}

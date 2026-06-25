/**
 * M33 phase 2 — project-local plugin frontend assets.
 *
 * The serving layer for "Option B" plugin frontends. A trusted project ships a
 * precompiled bundle at `<cwd>/.claude4spec/plugins/<name>/dist/frontend.js`
 * (+ optional `frontend.css`); the host streams those bytes and advertises them
 * in the frontend manifest. This express-free module owns the single
 * path/trust convention shared by the serving route (`routes/plugins.ts`) and
 * the manifest builder (`frontend-manifest.ts`), so the two cannot diverge.
 *
 * Trust: serving project-committed bundles is gated by `trustProjectPlugins`
 * (per workspace × project, machine-local). The CALLER resolves the gate and
 * passes `trusted`; an untrusted/undecided project emits nothing — exactly like
 * the overlay loader refuses to run untrusted project code.
 */

import fs from 'node:fs';
import path from 'node:path';
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

/** One project-local plugin with a built frontend bundle. */
export interface FrontendBundle {
  /** Package directory name under `.claude4spec/plugins/` (the manifest `name`). */
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

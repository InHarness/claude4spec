/**
 * M33 process-level plugin routes. Mounted at `/api` (before the
 * `/api/projects/:id` dispatch) — the plugin catalog is process-global, so
 * these are reachable with a plain `fetch` (no project prefix):
 *
 *   GET /api/plugins/frontend-manifest   → import map + active plugins ("Option B")
 *   GET /api/plugins/runtime/<peer>.js   → shared-singleton ESM shim
 *   GET /api/plugins/<name>/frontend.js  → plugin frontend (overlay: trust-gated, workspace: ungated)
 *   GET /api/plugins/<name>/frontend.css → plugin styles  (overlay: trust-gated, workspace: ungated)
 *   GET /api/_meta/plugins               → loader diagnostics (per-package state)
 */

import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
import type { PluginRegistry } from '../core/plugin-host/types.js';
import type { PluginLoadRecord } from '../core/plugin-host/loader.js';
import { buildFrontendManifest } from '../core/plugin-host/frontend-manifest.js';
import {
  assetContentType,
  resolveOverlayAsset,
  resolveWorkspaceAsset,
} from '../core/plugin-host/frontend-assets.js';
import { getRuntimeShim } from '../core/plugin-host/runtime-shims.js';
// M33 phase 3: base-package assembly lives in a shared, express-free module so
// the `c4s plugins` CLI reuses the SAME logic (no divergence). Re-exported here
// for the existing `../routes/plugins.js` import sites (e.g. project-context).
import { buildBasePluginPackages } from '../core/plugin-host/base-packages.js';
export { buildBasePluginPackages } from '../core/plugin-host/base-packages.js';

export interface PluginRoutesDeps {
  pluginRegistry: PluginRegistry;
  /** Per-package outcomes from the M33 bootstrap loader (workspace/npm layer). */
  pluginRecords: PluginLoadRecord[];
  /**
   * M33 phase 2: the process's primary project, whose project-local plugin
   * frontends these process-global routes serve. Absent on workspace-only
   * starts (nothing registered) ⇒ serving is disabled and the manifest lists no
   * plugins. `isTrusted()` is read per request, so a `POST /trust-plugins` flip
   * takes effect without a process restart.
   */
  frontendServing?: { cwd: string; isTrusted: () => boolean };
  /**
   * M33 phase 3: the process's resolved workspace plugin package names (the same
   * list `loadWorkspacePlugins` consumed). Their frontends are served UNGATED for
   * every project, and they are advertised in the manifest. Empty by default.
   */
  workspacePackages?: string[];
}

/** Diagnostics response — array of per-package records, extensible for phase 2. */
export interface PluginsMetaResponse {
  hostApiVersion: string;
  packages: PluginLoadRecord[];
}

export function pluginsRouter(deps: PluginRoutesDeps): Router {
  const { pluginRegistry, pluginRecords, frontendServing, workspacePackages = [] } = deps;
  const router = Router();

  router.get('/plugins/frontend-manifest', (_req, res) => {
    const serving = frontendServing
      ? { cwd: frontendServing.cwd, trusted: frontendServing.isTrusted() }
      : undefined;
    res.json(buildFrontendManifest(pluginRegistry, serving, workspacePackages));
  });

  router.get('/plugins/runtime/:file', async (req, res, next) => {
    try {
      const slug = req.params.file.replace(/\.js$/, '');
      const source = await getRuntimeShim(slug);
      if (source == null) {
        return res.status(404).json({
          error: { code: 'PLUGIN_RUNTIME_NOT_FOUND', message: `unknown runtime peer "${slug}"` },
        });
      }
      res.type('text/javascript').send(source);
    } catch (err) {
      next(err);
    }
  });

  // M33: stream any asset from a plugin's precompiled bundle dir (`dist/`). The
  // entry `frontend.js` is native ESM (m33l5fe0 — the host does NOT re-bundle),
  // so its relative imports (e.g. a code-split `./dto-*.js` chunk, source maps)
  // resolve to siblings under `/api/plugins/<name>/<asset>`. Two tiers, tried in
  // order, each strictly contained in the bundle dir + extension-allowlisted:
  //   1. overlay (phase 2) — the trusted primary project's
  //      `.claude4spec/plugins/<name>/dist/<asset>` (trust-gated); then
  //   2. workspace (phase 3) — a workspace/npm plugin's `dist/<asset>`, UNGATED,
  //      bounded to `workspacePackages` (which also guards traversal).
  // The gate, the unknown-package/disallowed-extension guard, and the
  // missing-file case all collapse to the same `404 PLUGIN_FRONTEND_NOT_FOUND`.
  router.get('/plugins/:name/:asset', (req: Request, res: Response) => {
    const name = req.params.name!;
    const asset = req.params.asset!;
    const contentType = assetContentType(asset);
    const abs =
      contentType &&
      ((frontendServing &&
        resolveOverlayAsset(frontendServing.cwd, frontendServing.isTrusted(), name, asset)) ||
        resolveWorkspaceAsset(name, asset, workspacePackages));
    if (!abs || !contentType) {
      return res.status(404).json({
        error: {
          code: 'PLUGIN_FRONTEND_NOT_FOUND',
          message: `no ${asset} for plugin "${name}"`,
        },
      });
    }
    // `nosniff` so a mistyped bundle can't be reinterpreted (mirrors routes/static).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(contentType);
    fs.createReadStream(abs)
      .on('error', () => {
        if (!res.headersSent) res.status(404).end();
      })
      .pipe(res);
  });

  router.get('/_meta/plugins', (_req, res) => {
    const response: PluginsMetaResponse = {
      hostApiVersion: HOST_API_VERSION,
      packages: buildBasePluginPackages(pluginRegistry, pluginRecords),
    };
    res.json(response);
  });

  return router;
}

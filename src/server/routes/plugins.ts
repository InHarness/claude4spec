/**
 * M33 process-level plugin routes. Mounted at `/api` (before the
 * `/api/projects/:id` dispatch) — the plugin catalog is process-global, so
 * these are reachable with a plain `fetch` (no project prefix):
 *
 *   GET /api/plugins/frontend-manifest   → announced plugin frontends ("Option B")
 *   GET /api/plugins/runtime/<peer>.js   → shared-singleton ESM shim
 *   GET /api/plugins/<name>/<asset>      → a `.js` / `.css` / `.map` file from the
 *                                          folder of the plugin's frontend entry
 *                                          (overlay: trust-gated; npm, envelope: ungated)
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
  loadedRecordKeys,
  resolvePluginAsset,
  type FrontendPool,
  type WorkspaceRootResolver,
} from '../core/plugin-host/frontend-assets.js';
import {
  PLUGIN_FRONTEND_NOT_FOUND,
  type PluginFrontendAssetError,
} from '../../shared/plugin-host/frontend-manifest.js';
import { getRuntimeShim } from '../core/plugin-host/runtime-shims.js';
// M33 phase 3: base-package assembly lives in a shared, express-free module so
// the `c4s plugins` CLI reuses the SAME logic (no divergence). Re-exported here
// for the existing `../routes/plugins.js` import sites (e.g. project-context).
import { buildBasePluginPackages } from '../core/plugin-host/base-packages.js';
import type { BuiltinEnvelope } from '../core/plugin-host/builtin-envelopes.js';
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
  frontendServing?: {
    cwd: string;
    isTrusted: () => boolean;
    /**
     * 2.1.20: the overlay folders whose BACKEND is `loaded` in the primary
     * project's context (its overlay load records). Only those announce and serve
     * a frontend — the same filter as the base pool. Absent ⇒ none.
     */
    overlayLoaded?: () => ReadonlySet<string> | Promise<ReadonlySet<string>>;
  };
  /**
   * M33 phase 3: the process's resolved workspace plugin package names (the same
   * list `loadWorkspacePlugins` consumed). Their frontends are served UNGATED for
   * every project, and they are advertised in the manifest. Empty by default.
   */
  workspacePackages?: string[];
  /**
   * 0.2.2: builtin envelopes discovered under `<hostRoot>/plugins/`. Ungated —
   * an envelope is in the host repo, so this list IS its own allowlist and never
   * comes from a request.
   */
  envelopes?: BuiltinEnvelope[];
  /** Test seam: how a workspace package's root is found (default: `import.meta.resolve`). */
  resolveWorkspaceRoot?: WorkspaceRootResolver;
}

/** Diagnostics response — array of per-package records, extensible for phase 2. */
export interface PluginsMetaResponse {
  hostApiVersion: string;
  packages: PluginLoadRecord[];
}

export function pluginsRouter(deps: PluginRoutesDeps): Router {
  const {
    pluginRegistry,
    pluginRecords,
    frontendServing,
    workspacePackages = [],
    envelopes = [],
    resolveWorkspaceRoot,
  } = deps;
  const router = Router();

  /**
   * The effective frontend pool, read live per request: the trust gate, the
   * overlay's load records and the base records (`pluginRecords` — envelopes +
   * npm packages, kept current across hot reloads) can all change while the
   * process runs. The manifest and the asset route read the SAME pool, so a name
   * is served from exactly the source the manifest announced.
   */
  async function currentPool(): Promise<FrontendPool> {
    const baseLoaded = loadedRecordKeys(pluginRecords);
    const trusted = frontendServing ? frontendServing.isTrusted() : false;
    return {
      envelopes: { list: envelopes, loaded: baseLoaded },
      npm: { packages: workspacePackages, loaded: baseLoaded, resolveRoot: resolveWorkspaceRoot },
      overlay: frontendServing
        ? {
            cwd: frontendServing.cwd,
            trusted,
            loaded: trusted && frontendServing.overlayLoaded
              ? await frontendServing.overlayLoaded()
              : new Set<string>(),
          }
        : undefined,
    };
  }

  router.get('/plugins/frontend-manifest', async (_req, res, next) => {
    try {
      res.json(buildFrontendManifest(await currentPool()));
    } catch (err) {
      next(err);
    }
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

  // M33 (2.1.20): `GET /api/plugins/:name/:asset` — any `.js` / `.css` / `.map`
  // file in the folder of the plugin's resolved frontend entry. The entry is
  // native ESM (the host does not re-bundle), so its relative imports (a
  // code-split `./dto-*.js` chunk, a source map) resolve to siblings here. The
  // source is the one the manifest announces for `:name` (overlay > npm package >
  // envelope, backend `loaded` only). Every refusal — disallowed extension, a
  // separator or `..` in the file name, an untrusted overlay, a missing file — is
  // the same `404 PLUGIN_FRONTEND_NOT_FOUND`.
  router.get('/plugins/:name/:asset', async (req: Request, res: Response, next) => {
    const name = req.params.name!;
    const asset = req.params.asset!;
    let abs: string | null;
    try {
      abs = resolvePluginAsset(await currentPool(), name, asset);
    } catch (err) {
      return next(err);
    }
    const contentType = abs ? assetContentType(abs) : null;
    if (!abs || !contentType) {
      const body: PluginFrontendAssetError = {
        error: { code: PLUGIN_FRONTEND_NOT_FOUND, message: 'Plugin frontend asset not found' },
      };
      return res.status(404).json(body);
    }
    // `nosniff` so a mistyped bundle can't be reinterpreted (mirrors routes/static).
    // No `Cache-Control`: the entry URL's cache-bust is the package version.
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

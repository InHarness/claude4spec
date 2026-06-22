/**
 * M33 process-level plugin routes. Mounted at `/api` (before the
 * `/api/projects/:id` dispatch) — the plugin catalog is process-global, so
 * these are reachable with a plain `fetch` (no project prefix):
 *
 *   GET /api/plugins/frontend-manifest  → import map + active plugins ("Option B")
 *   GET /api/plugins/runtime/<peer>.js  → shared-singleton ESM shim
 *   GET /api/plugins/<name>/frontend.js → plugin frontend entry (404 in phase 1)
 *   GET /api/_meta/plugins              → loader diagnostics (per-package state)
 */

import { Router } from 'express';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
import type { PluginRegistry } from '../core/plugin-host/types.js';
import type { PluginLoadRecord } from '../core/plugin-host/loader.js';
import { buildFrontendManifest } from '../core/plugin-host/frontend-manifest.js';
import { getRuntimeShim } from '../core/plugin-host/runtime-shims.js';

export interface PluginRoutesDeps {
  pluginRegistry: PluginRegistry;
  /** Per-package outcomes from the M33 bootstrap loader (workspace/npm layer). */
  pluginRecords: PluginLoadRecord[];
}

/** Diagnostics response — array of per-package records, extensible for phase 2. */
export interface PluginsMetaResponse {
  hostApiVersion: string;
  packages: PluginLoadRecord[];
}

const SYNTHETIC_BUILTIN_PACKAGE = '@c4s/builtin';

export function pluginsRouter(deps: PluginRoutesDeps): Router {
  const { pluginRegistry, pluginRecords } = deps;
  const router = Router();

  router.get('/plugins/frontend-manifest', (_req, res) => {
    res.json(buildFrontendManifest(pluginRegistry));
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

  // Phase 1 carves out the contract; phase 2 streams the project-local file
  // from `.claude4spec/plugins/<name>/` as native ESM behind the trust gate.
  router.get('/plugins/:name/frontend.js', (req, res) => {
    res.status(404).json({
      error: {
        code: 'PLUGIN_FRONTEND_NOT_FOUND',
        message: `no frontend entry for plugin "${req.params.name}" (phase 1 ships no plugin packages)`,
      },
    });
  });

  router.get('/_meta/plugins', (_req, res) => {
    const loadedTypes = new Set(
      pluginRecords.flatMap((r) => (r.status === 'loaded' ? r.contributedTypes ?? [] : [])),
    );
    const builtinTypes = pluginRegistry
      .listAvailable()
      .map((m) => m.type)
      .filter((t) => !loadedTypes.has(t));

    const builtinRecord: PluginLoadRecord = {
      package: SYNTHETIC_BUILTIN_PACKAGE,
      status: 'loaded',
      contributedTypes: builtinTypes,
    };

    const response: PluginsMetaResponse = {
      hostApiVersion: HOST_API_VERSION,
      packages: [builtinRecord, ...pluginRecords],
    };
    res.json(response);
  });

  return router;
}

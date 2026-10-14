/**
 * M33 process-level plugin routes. Mounted at `/api` (before the
 * `/api/projects/:id` dispatch) — they depend on no project, so they are
 * reachable with a plain `fetch` (no project prefix):
 *
 *   GET /api/plugins/runtime/<peer>.js   → shared-singleton ESM shim
 *   GET /api/plugins/<name>/<asset>      → a `.js` / `.css` / `.map` file from the
 *                                          folder of a BASE-tier plugin's frontend
 *                                          entry (npm package or built-in envelope,
 *                                          ungated) — never a project-local overlay
 *   GET /api/_meta/plugins               → loader diagnostics (per-package state)
 *
 * 2.1.22: the frontend manifest and the overlay assets live on the PROJECT
 * router (`./plugins-project.ts`, under `/api/projects/:id`); nothing here is
 * bound to the project the process started with.
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
import type { PluginRegistry } from '../core/plugin-host/types.js';
import type { PluginLoadRecord } from '../core/plugin-host/loader.js';
import {
  assetContentType,
  basePool,
  resolveBaseAsset,
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
  /**
   * Per-package outcomes from the M33 bootstrap loader (envelopes + workspace/npm
   * layer), kept current across base hot reloads — read per request.
   */
  pluginRecords: PluginLoadRecord[];
  /**
   * M33 phase 3: the process's resolved workspace plugin package names (the same
   * list `loadWorkspacePlugins` consumed). Their frontends are served UNGATED.
   * Empty by default.
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

/** The one 404 body of both plugin asset routes. */
export function sendPluginAssetNotFound(res: Response): void {
  const body: PluginFrontendAssetError = {
    error: { code: PLUGIN_FRONTEND_NOT_FOUND, message: 'Plugin frontend asset not found' },
  };
  res.status(404).json(body);
}

/** A strong validator derived from the file's content. */
function contentEtag(body: Buffer): string {
  return `"${createHash('sha256').update(body).digest('base64url')}"`;
}

/** Does an `If-None-Match` header name `etag` (weak comparison, `*` matches)? */
function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = etag.replace(/^W\//, '');
  return header
    .split(',')
    .map((t) => t.trim())
    .some((t) => t === '*' || t.replace(/^W\//, '') === bare);
}

/**
 * Stream a resolved plugin asset, shared by both asset routes (L11 `9g96q3pp`,
 * "freshness under a fixed address"): the entry and chunk URLs do not change
 * when the frontend is rebuilt, so every 200 carries `Cache-Control: no-cache`
 * and an `ETag` derived from the file's content — the browser revalidates on
 * every use, a rebuilt file comes back as 200 with the new body, an unchanged
 * one costs a 304 without a body. `nosniff` so a mistyped bundle can't be
 * reinterpreted (mirrors routes/static). `abs === null` or a disallowed
 * extension → 404 `PLUGIN_FRONTEND_NOT_FOUND`; a read error before any header
 * was sent → 404 without a body.
 */
export async function sendPluginAsset(req: Request, res: Response, abs: string | null): Promise<void> {
  const contentType = abs ? assetContentType(abs) : null;
  if (!abs || !contentType) return sendPluginAssetNotFound(res);
  let body: Buffer;
  try {
    body = await fs.promises.readFile(abs);
  } catch {
    if (!res.headersSent) res.status(404).end();
    return;
  }
  const etag = contentEtag(body);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', etag);
  if (ifNoneMatchHits(req.get('If-None-Match'), etag)) {
    res.status(304).end();
    return;
  }
  res.type(contentType);
  res.status(200).end(body);
}

/** Diagnostics response — array of per-package records, extensible for phase 2. */
export interface PluginsMetaResponse {
  hostApiVersion: string;
  packages: PluginLoadRecord[];
}

export function pluginsRouter(deps: PluginRoutesDeps): Router {
  const { pluginRegistry, pluginRecords } = deps;
  const router = Router();

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

  // M33 (2.1.22): `GET /api/plugins/:name/:asset` — the BASE tier only: any
  // `.js` / `.css` / `.map` file in the folder of the resolved frontend entry of
  // an npm package or a built-in envelope (npm over envelope on a name
  // collision, backend `loaded` only), with no trust gate and no project. It
  // never serves a project-local overlay — that is the project route's
  // (`plugins-project.ts`) — so an overlay of the same name changes nothing here.
  // Every refusal is the same `404 PLUGIN_FRONTEND_NOT_FOUND`.
  router.get('/plugins/:name/:asset', async (req: Request, res: Response, next) => {
    let abs: string | null;
    try {
      // The base records are read per request: a hot reload keeps them current.
      abs = resolveBaseAsset(basePool(deps), req.params.name!, req.params.asset!);
    } catch (err) {
      return next(err);
    }
    await sendPluginAsset(req, res, abs);
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

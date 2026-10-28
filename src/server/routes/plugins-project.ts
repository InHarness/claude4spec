/**
 * M33 (2.1.22) — the plugin frontend routes of ONE project, mounted on its
 * per-context router (so the paths resolve under `/api/projects/:id`; the M31
 * prefix answers 404 `PROJECT_NOT_IN_WORKSPACE` / 500 `PROJECT_BUILD_FAILED`
 * before these handlers ever run):
 *
 *   GET /plugins/frontend-manifest  → the project's FrontendManifestResponse:
 *                                     base tier ∪ this project's overlay
 *   GET /plugins/:name/:asset       → a `.js` / `.css` / `.map` file of THIS
 *                                     project's overlay, or 404
 *                                     PluginFrontendAssetError
 *
 * The manifest's overlay entries and the asset route share one condition
 * (L11 `9g96q3pp`): `trustProjectPlugins` of `(workspace × :id)` read LIVE per
 * request, AND a plugin of that name in the overlay of the CURRENT context
 * instance. Revoking consent outside the server process (the CLI) therefore
 * cuts both at once, without a context rebuild; granting it takes effect from
 * the next build (the overlay is only loaded at build time).
 *
 * 2.1.57 (M13 `m13actv0`): the manifest's second condition is type activation —
 * a plugin contributing entity types is announced only when at least one of its
 * types is active in this project's `config.entities` (`isTypeActive`, the
 * context's host). The asset route does not consult it.
 *
 * 2.1.58 (L11 `9g96q3pp`): no project is distinguished at start — every
 * project of the workspace gets its manifest and its overlay, and the answer
 * depends on no project but `:id`.
 */

import { Router, type Request, type Response } from 'express';
import { buildFrontendManifest, type ManifestActivation } from '../core/plugin-host/frontend-manifest.js';
import {
  basePool,
  loadedRecordKeys,
  loadedRecordTypes,
  resolveOverlayAsset,
  type FrontendBaseDeps,
  type FrontendLoadRecord,
  type FrontendPool,
} from '../core/plugin-host/frontend-assets.js';
import { sendPluginAsset } from './plugins.js';

export interface ProjectPluginsFrontendDeps {
  /** The stored project id — the `:id` segment of every overlay URL. */
  projectId: string;
  /** The project directory whose `.claude4spec/plugins/` is the overlay. */
  cwd: string;
  /** `trustProjectPlugins` of `(workspace × projectId)`, read live per request. */
  isTrusted: () => boolean;
  /**
   * The overlay's load records of the context instance that owns this router —
   * fixed for the instance's life, rebuilt with the context. Its `loaded`
   * folders and the entity types they contributed are read from here.
   */
  overlayRecords: ReadonlyArray<FrontendLoadRecord>;
  /** The process's base tier (the same for every project). */
  base: FrontendBaseDeps;
  /** Whether an entity type is active in this project's `config.entities` (the context's host). */
  isTypeActive: (type: string) => boolean;
}

export function projectPluginsFrontendRouter(deps: ProjectPluginsFrontendDeps): Router {
  const router = Router();
  const overlayLoaded = loadedRecordKeys(deps.overlayRecords);
  const overlayTypes = loadedRecordTypes(deps.overlayRecords);

  /** The project's pool, read now: base records and the trust flag can change while the process runs. */
  const currentPool = (): FrontendPool => ({
    ...basePool(deps.base),
    overlay: { cwd: deps.cwd, trusted: deps.isTrusted(), loaded: overlayLoaded },
  });

  /** Type activation, with the base records' types read now (they change across hot reloads). */
  const currentActivation = (): ManifestActivation => {
    const baseTypes = loadedRecordTypes(deps.base.pluginRecords);
    return {
      typesOf: (src) => (src.kind === 'overlay' ? overlayTypes : baseTypes).get(src.recordKey) ?? [],
      isActive: deps.isTypeActive,
    };
  };

  router.get('/plugins/frontend-manifest', (_req, res, next) => {
    try {
      res.json(buildFrontendManifest(deps.projectId, currentPool(), currentActivation()));
    } catch (err) {
      next(err);
    }
  });

  // The file is PICKED by the overlay plugin's name, never composed from the
  // path parameter: a separator or `..` in `:name` matches no overlay folder.
  router.get('/plugins/:name/:asset', async (req: Request, res: Response, next) => {
    let abs: string | null;
    try {
      abs = resolveOverlayAsset(currentPool().overlay, req.params.name!, req.params.asset!);
    } catch (err) {
      return next(err);
    }
    await sendPluginAsset(req, res, abs);
  });

  return router;
}

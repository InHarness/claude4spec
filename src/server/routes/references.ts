import { Router } from 'express';
import type { ReferencesService } from '../services/references.js';
import type { EntityType } from '../../shared/entities.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { errorHandler } from './errors.js';

/**
 * Validate `type` URL param against the plugin host registry; `section` is
 * accepted as a special non-entity case used by the references service.
 */
function assertType(host: ProjectPluginHost, type: string): EntityType {
  if (type === 'section') return type;
  if (host.getAvailable(type)) return type as EntityType;
  throw new Error(`unsupported entity type '${type}'`);
}

/** `?limit=12` → 12; absent, empty, non-numeric or non-positive → undefined (core default wins). */
function positiveInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function referencesRouter(
  host: ProjectPluginHost,
  references: ReferencesService,
  discovery: DiscoveryCore,
): Router {
  const router = Router();

  /**
   * 0.2.13 — the `rest` rendering of `find_references`, brought back in line
   * with the core.
   *
   * Two real gaps, both from this route calling `ReferencesService.findReferences
   * (type, slug)` — which passes the core NO options:
   *
   *   - `includeTagMatches` was unreachable, so phase 2 never ran and a caller
   *     over REST could not learn that a `<tagged_list/>` matches the entity it
   *     is about to rename. Over MCP and CLI it could.
   *   - the discriminated `target` union existed in the core (`entity` |
   *     `section` | `page`) but no REST path reached the section and page arms,
   *     even though this route already validated `section` as a `type`.
   *
   * Both are additive. `?type=&slug=` keeps working exactly as before and the
   * response keeps its `{ references }` key, so the client's `referencesApi.find`
   * is untouched; `total`/`hasMore` come along beside it for callers that page.
   */
  router.get('/', async (req, res, next) => {
    try {
      const target = typeof req.query.target === 'string' ? req.query.target : 'entity';
      const limit = positiveInt(req.query.limit);
      const offset = positiveInt(req.query.offset);
      // Accept the bare flag (`?includeTagMatches`) and the explicit `=true`,
      // mirroring how the CLI accepts `--include-tag-matches` either way.
      const includeTagMatches =
        req.query.includeTagMatches === '' ||
        req.query.includeTagMatches === 'true' ||
        req.query.includeTagMatches === '1';
      const paging = {
        ...(includeTagMatches ? { includeTagMatches } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
      };

      if (target === 'section') {
        const anchor = typeof req.query.anchor === 'string' ? req.query.anchor : null;
        if (!anchor) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'anchor query param required for target=section' } });
        }
        const result = await discovery.findReferences({ target: 'section', anchor, ...paging });
        return res.json({ references: result.references, total: result.total, hasMore: result.hasMore });
      }

      if (target === 'page') {
        const rootId = typeof req.query.rootId === 'string' ? req.query.rootId : null;
        const pagePath = typeof req.query.path === 'string' ? req.query.path : null;
        if (!rootId || !pagePath) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'rootId and path query params required for target=page' } });
        }
        const result = await discovery.findReferences({ target: 'page', rootId, path: pagePath, ...paging });
        return res.json({ references: result.references, total: result.total, hasMore: result.hasMore });
      }

      const type = typeof req.query.type === 'string' ? assertType(host, req.query.type) : null;
      const slug = typeof req.query.slug === 'string' ? req.query.slug : null;
      if (!type || !slug) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'type and slug query params required' } });
      }
      /**
       * The service call is kept for the plain, unparameterised case that the UI
       * makes — it is the same core operation with the same defaults, and going
       * through the service preserves the reference-hydration the client's
       * chips rely on. Anything that asks for tag matches or a page window goes
       * to the core directly, because that is where those options live.
       */
      if (!includeTagMatches && limit === undefined && offset === undefined) {
        const hits = await references.findReferences(type, slug);
        return res.json({ references: hits });
      }
      const result = await discovery.findReferences({ target: 'entity', type, slug, ...paging });
      res.json({ references: result.references, total: result.total, hasMore: result.hasMore });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}

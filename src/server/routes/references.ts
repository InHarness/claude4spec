import { Router } from 'express';
import type { ReferencesService } from '../services/references.js';
import type { EntityType } from '../../shared/entities.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { findReferencesAllPaged } from '../discovery/index.js';
import { invalidType } from '../discovery/errors.js';
import { errorHandler } from './errors.js';

/**
 * Validate `type` against the plugin host registry; `section` is accepted as a
 * special non-entity case the references service has always supported.
 *
 * 0.2.13: this used to `throw new Error(...)`, which the error handler could
 * only classify as `500 INTERNAL`. A caller who mistyped a type name — the most
 * ordinary mistake there is on this route — got "internal server error" and no
 * list of what would have worked. That contradicts the release's own contract
 * for this channel: `INVALID_ARGUMENT` carries a repair path, and the repair
 * path for a wrong type is the set of active ones.
 *
 * `invalidType` is the core's own constructor, so the message and the
 * alternatives are phrased once, by the core, and re-framed by every transport
 * rather than re-invented per route — the same call `entities-router` makes.
 */
function assertType(host: ProjectPluginHost, type: string): EntityType {
  if (type === 'section') return type;
  if (host.getAvailable(type)) return type as EntityType;
  throw invalidType(
    type,
    host.listEntities().map((m) => m.type),
  );
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
       * The entity target answers from the SERVICE, always, and the window is
       * applied here.
       *
       * Handing `limit`/`offset` to the core instead looks equivalent and is not,
       * in three ways a caller notices:
       *
       *   - SHAPE. `ops/references.ts` maps its hits through a projection that
       *     drops `raw` — the original tag text. The published `ReferenceHit`
       *     declares `raw` as required and the reference chips render it, so a
       *     request that merely added `&limit=` came back with empty chips and no
       *     error to explain them.
       *   - TYPE VOCABULARY. `assertType` admits the non-entity pseudo-type
       *     `section`, which this route has accepted since long before the core
       *     existed; `entityReferences` refuses anything `host.getEntity()` does
       *     not know. So `?type=section&slug=x` answered 200, and
       *     `?type=section&slug=x&limit=20` answered 404 INVALID_TYPE.
       *   - COMPLETENESS. The core paginates at `DEFAULT_LIMITS.findReferences`
       *     (100). An entity cited on 150 pages answered with 150 references
       *     plain and 100 with a flag set — the caller asking the BIGGER question
       *     ("what breaks if I rename this") got the smaller answer.
       *
       * `includeTagMatches` is the one thing the service cannot do, so it — and
       * only it — goes to the core.
       */
      if (!includeTagMatches) {
        const hits = await references.findReferences(type, slug);
        if (limit === undefined && offset === undefined) return res.json({ references: hits });
        const start = offset ?? 0;
        const window = limit === undefined ? hits.slice(start) : hits.slice(start, start + limit);
        return res.json({ references: window, total: hits.length, hasMore: start + window.length < hits.length });
      }

      /**
       * Tag matches: the core's phase 2, which no service method exposes.
       *
       * With no explicit window the exhaustive helper is used rather than one
       * `findReferences` call, so this path cannot silently stop at the core's
       * default page. `exhausted: false` means the runaway guard tripped, which
       * is reported as `hasMore` rather than passed off as a complete answer.
       */
      if (limit === undefined && offset === undefined) {
        const { references: all, exhausted } = await findReferencesAllPaged(discovery, {
          target: 'entity',
          type,
          slug,
          includeTagMatches: true,
        });
        return res.json({ references: all, total: all.length, hasMore: !exhausted });
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

import { Router } from 'express';
import type { ReferencesService } from '../services/references.js';
import type { EntityType } from '../../shared/entities.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { findReferencesAllPaged } from '../discovery/index.js';
import { invalidType } from '../discovery/errors.js';
import { errorHandler } from './errors.js';
import { boolFlag, nonNegativeInt, positiveInt } from './query-params.js';

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

export function referencesRouter(
  host: ProjectPluginHost,
  references: ReferencesService,
  discovery: DiscoveryCore,
  /**
   * 0.2.13 (tier C) — build a one-off core over a narrowed root list, for
   * `?pages=<dir>`. A factory rather than a second core built up front: the
   * override is per-request, and a project serves far more requests without it
   * than with it. See `discovery/pages-override.ts` for what "narrowed" means.
   */
  discoveryForRoots: (pagesOverride: string) => DiscoveryCore,
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
      /**
       * `nonNegativeInt`, and the difference is not cosmetic.
       *
       * This route kept a private `positiveInt` for BOTH parameters while the
       * rest of the release moved onto the shared readers, and `positiveInt('0')`
       * is `undefined` — so `?offset=0`, the ordinary way to ask for the first
       * page, read as "no window given" and dropped the request into the
       * exhaustive-sweep branch below. A caller asking for 100 rows got every
       * citation in the project, in one body, having asked for the opposite.
       *
       * That is exactly what `query-params.ts` was added for: zero is a
       * legitimate offset and a meaningless limit, so the two parameters cannot
       * share a reader.
       */
      const offset = nonNegativeInt(req.query.offset);
      // Accept the bare flag (`?includeTagMatches`) and the explicit `=true`,
      // mirroring how the CLI accepts `--include-tag-matches` either way.
      const includeTagMatches = boolFlag(req.query.includeTagMatches);
      const paging = {
        ...(includeTagMatches ? { includeTagMatches } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
      };

      /**
       * 0.2.13 (tier C) — `?pages=<dir>` narrows the sweep to one directory.
       *
       * Every arm below runs against `core` rather than `discovery`, so the
       * narrowing applies to sections and pages as well as entities — the
       * override names the ROOT LIST the sweep walks, not a target kind.
       *
       * It also forces the entity arm off the `ReferencesService` shortcut and
       * onto the core, which is the whole reason the shortcut is conditional:
       * the service reads the project's CONFIGURED roots and has no notion of a
       * narrowed list, so answering from it would silently ignore the parameter
       * and hand back a project-wide sweep labelled as a narrowed one.
       */
      const pagesOverride =
        typeof req.query.pages === 'string' && req.query.pages.trim() !== ''
          ? req.query.pages.trim()
          : undefined;
      /**
       * LAZY, and memoized within the request. Building the narrowed core eagerly
       * would build one for a request this handler is about to refuse — cheap,
       * but the request that gets refused is exactly the one where "we built a
       * core over your directory" is untrue.
       */
      let narrowed: DiscoveryCore | undefined;
      const core = (): DiscoveryCore => {
        if (!pagesOverride) return discovery;
        return (narrowed ??= discoveryForRoots(pagesOverride));
      };

      if (target === 'section') {
        const anchor = typeof req.query.anchor === 'string' ? req.query.anchor : null;
        if (!anchor) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'anchor query param required for target=section' } });
        }
        const result = await core().findReferences({ target: 'section', anchor, ...paging });
        return res.json({ references: result.references, total: result.total, hasMore: result.hasMore });
      }

      if (target === 'page') {
        const rootId = typeof req.query.rootId === 'string' ? req.query.rootId : null;
        const pagePath = typeof req.query.path === 'string' ? req.query.path : null;
        if (!rootId || !pagePath) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'rootId and path query params required for target=page' } });
        }
        const result = await core().findReferences({ target: 'page', rootId, path: pagePath, ...paging });
        return res.json({ references: result.references, total: result.total, hasMore: result.hasMore });
      }

      const type = typeof req.query.type === 'string' ? assertType(host, req.query.type) : null;
      const slug = typeof req.query.slug === 'string' ? req.query.slug : null;
      if (!type || !slug) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'type and slug query params required' } });
      }

      /**
       * The entity target answers from the CORE. Only `section` still does not.
       *
       * Until this release the entity arm answered from `ReferencesService`
       * unless `includeTagMatches` was set, for three stated reasons. Two of them
       * have stopped being true, and keeping the shortcut for the third was
       * costing the caller a field:
       *
       *   - SHAPE. The core's projection used to drop `raw`, the original tag
       *     text the reference chips render. It stopped dropping it earlier in
       *     0.2.13 (`ops/references.ts` forwards it now), so this reason expired
       *     with that fix and the shortcut outlived it.
       *   - COMPLETENESS. The core paginates at `DEFAULT_LIMITS.findReferences`
       *     (100), so a windowless request through it used to answer 100 of an
       *     entity's 150 citations. `findReferencesAllPaged` is what closes that,
       *     and it is used below whenever no window was asked for.
       *   - TYPE VOCABULARY. This one still holds: `assertType` admits the
       *     non-entity pseudo-type `section`, which `entityReferences` refuses.
       *     So `section` — and nothing else — keeps the service.
       *
       * What the shortcut cost: the SERVICE projects hits down to
       * `{ rootId, pagePath, tagType, line, raw }` (`services/references.ts`),
       * dropping the `anchor` the core attaches to every hit falling inside an
       * indexed section. That anchor is the entire link from a reference to
       * `get-sections` / `list-sections --by anchor` — the path the CLI help
       * advertises — and `c4s find-references … | jq '.references[].anchor'`
       * answered `null` for every hit while the operation reached over MCP
       * answered correctly. One operation, two answers, which is the drift this
       * release exists to remove.
       */
      /**
       * `section` never reaches the core, whatever the flags say.
       *
       * It is a pseudo-type this route has always accepted and `assertType`
       * still admits, but `entityReferences` refuses anything `host.getEntity()`
       * does not know. Routing it to the core on the `includeTagMatches` path
       * meant `?type=section&slug=intro` answered 200 while the same request
       * with `&includeTagMatches=true` answered 404 INVALID_TYPE — telling a
       * caller who merely turned on tag matching that the type does not exist,
       * and offering a list of entity types that will never contain a section.
       *
       * Tag matching is meaningless for it anyway: phase 2 matches an ENTITY
       * against `<tagged_list/>` queries, and a section is not tagged. So the
       * service answers, and the flag is a no-op rather than an error.
       *
       * `?pages=` is a different matter and IS refused here. A no-op flag is
       * fine when turning it on cannot change the answer; a narrowing that is
       * quietly dropped hands back a project-wide sweep labelled as a narrowed
       * one, which is the failure this parameter exists to avoid.
       */
      if (type === 'section' && pagesOverride) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION',
            message: "pages cannot be combined with type=section — the section pseudo-type is answered by the references service, which walks the project's configured roots",
          },
        });
      }
      if (type === 'section') {
        const hits = await references.findReferences(type, slug);
        if (limit === undefined && offset === undefined) return res.json({ references: hits });
        const start = offset ?? 0;
        const window = limit === undefined ? hits.slice(start) : hits.slice(start, start + limit);
        return res.json({ references: window, total: hits.length, hasMore: start + window.length < hits.length });
      }

      /**
       * With no explicit window, the EXHAUSTIVE helper — not one
       * `findReferences` call, which would stop at the core's default page of
       * 100. `exhausted: false` means the runaway guard tripped, and is reported
       * as `hasMore` rather than passed off as a complete answer.
       *
       * `includeTagMatches` is FORWARDED, not asserted. It was hardcoded `true`
       * here while this path was reachable only when the caller had asked for
       * tag matches; once `?pages=` started routing through it too, a caller who
       * passed `pages` alone silently got phase-2 tag matches on top of the
       * direct citations — the same operation answering differently because of
       * an unrelated flag.
       */
      if (limit === undefined && offset === undefined) {
        const { references: all, exhausted } = await findReferencesAllPaged(core(), {
          target: 'entity',
          type,
          slug,
          includeTagMatches,
        });
        return res.json({ references: all, total: all.length, hasMore: !exhausted });
      }
      const result = await core().findReferences({ target: 'entity', type, slug, ...paging });
      res.json({ references: result.references, total: result.total, hasMore: result.hasMore });
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}

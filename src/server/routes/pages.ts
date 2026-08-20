import { Router, type Request, type Response } from 'express';
import type { PagesService } from '../services/pages.js';
import type { SelfWriteMarker } from '../fs/sources.js';
import {
  createPage,
  deletePage,
  updatePage,
  type PageDiffDeps,
  type SectionWriteDeps,
  type TextEdit,
} from '../services/page-write.js';
import type { FileVersionService } from '../services/file-version.js';
import type { Root } from '../../shared/types.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { DomainError } from '../services/tags.js';
import { errorHandler } from './errors.js';
import { nonNegativeInt, positiveInt } from './query-params.js';

/** 0.1.96: per-root runtime resolved from the `:rootId` path segment. */
export interface PageRootRuntime {
  root: Root;
  pages: PagesService;
  writer: SelfWriteMarker | null;
  /** The `file_version` axis a write reads its reported `version` back from. */
  versions?: FileVersionService | null;
}

/**
 * 0.1.96: pages router is mounted at `/pages/:rootId`. Each handler resolves the
 * target root's runtime via `resolveRoot(req.params.rootId)`; an unknown id →
 * 404 ROOT_NOT_FOUND (no fallback). The `file_version` store is shared across
 * roots and keyed by (rootId, path).
 */
/**
 * 0.2.13 (tier C) — `search_pages`, the CROSS-ROOT one.
 *
 * It gets a router of its own because the operation's scope is the project, not
 * a root: `rootId` is an optional NARROWING, and there is no root id to put in
 * the path when the caller omits it. Mounted at `/pages`, **ahead of**
 * `/pages/:rootId`, so `/api/pages/search` matches here; anything else falls
 * through to the per-root router. Register it the other way round and `search`
 * is read as a root id and answers `ROOT_NOT_FOUND` — the same trap
 * `/pages/:rootId/search` already carries inside its own router.
 *
 * Distinct from that per-root `/search`, which stays what it is: a `q`-only file
 * scan shaped for the UI. This one is the catalog operation — `regex`,
 * `hits`/`pages`/`count` modes, paging, and an anchor on every hit that falls
 * inside an indexed section.
 */
/**
 * `?range=1:200` → `{ start: 1, end: 200 }`, 1-based and inclusive.
 *
 * A malformed value is REFUSED rather than dropped. `range` narrows what comes
 * back, and a narrowing quietly ignored answers with the whole page while the
 * caller believes it asked for twenty lines.
 */
function parseRange(raw: unknown): { start: number; end: number } | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  const m = /^(\d+):(\d+)$/.exec(raw);
  if (!m) throw new DomainError('VALIDATION', `range must be '<from>:<to>', got '${raw}'`);
  return { start: Number(m[1]), end: Number(m[2]) };
}

export function crossRootPagesRouter(discovery: DiscoveryCore): Router {
  const router = Router();

  router.get('/search', async (req, res, next) => {
    try {
      const query = typeof req.query.q === 'string' && req.query.q !== '' ? req.query.q : undefined;
      const regex =
        typeof req.query.regex === 'string' && req.query.regex !== '' ? req.query.regex : undefined;
      const rootId = typeof req.query.rootId === 'string' && req.query.rootId !== '' ? req.query.rootId : undefined;
      const mode =
        req.query.mode === 'hits' || req.query.mode === 'pages' || req.query.mode === 'count'
          ? req.query.mode
          : undefined;
      res.json(
        await discovery.searchPages({
          ...(query !== undefined ? { query } : {}),
          ...(regex !== undefined ? { regex } : {}),
          ...(rootId !== undefined ? { rootId } : {}),
          ...(mode !== undefined ? { mode } : {}),
          ...(positiveInt(req.query.limit) !== undefined ? { limit: positiveInt(req.query.limit) } : {}),
          ...(nonNegativeInt(req.query.offset) !== undefined ? { offset: nonNegativeInt(req.query.offset) } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}

export function pagesRouter(
  resolveRoot: (rootId: string) => PageRootRuntime | undefined,
  pageVersions: FileVersionService | null,
  discovery: DiscoveryCore,
  /**
   * 0.2.13 review fix: the ids that DO exist, for the refusal below. Optional so
   * the hand-rolled test rigs keep compiling; a real project always passes it.
   */
  rootIds: () => string[] = () => [],
  /**
   * 0.2.37: the section-side deps the DIFFERENTIAL branch of `update_page`
   * needs for its `ANCHOR_LOSS` guard — the very same object `page-tools` is
   * built from, so the two channels ask the same question of the same index.
   *
   * Optional for the reason `sectionsRouter`'s is: the hand-rolled rigs that
   * mount this router for its read routes have no discovery core to hand over.
   * Absent, the guard degrades to report-only rather than lying about who cites
   * what.
   */
  writeDeps?: SectionWriteDeps,
): Router {
  // mergeParams so the mount-level `:rootId` is visible inside this router.
  const router = Router({ mergeParams: true });

  const resolve = (req: Request, res: Response): PageRootRuntime | null => {
    const rootId = (req.params as Record<string, string>).rootId ?? '';
    const rt = resolveRoot(rootId);
    if (!rt) {
      /**
       * The refusal carries the roots that DO exist.
       *
       * Before the CLI moved server-side this refusal came from the core
       * (`PageSource.service()` → `invalidArgument('unknown rootId …', 'roots in
       * this project: …')`), so `c4s list-pages --root-id typo` printed the
       * list. This short-circuits ahead of the core, and the first version of it
       * answered a bare message — turning a one-keystroke mistake into a dead
       * end on the surface whose whole job is to be navigable. The catalog's own
       * contract says a NOT_FOUND carries its alternatives.
       */
      const known = rootIds();
      res.status(404).json({
        error: {
          code: 'ROOT_NOT_FOUND',
          message: `root '${rootId}' not found`,
          ...(known.length ? { hint: `roots in this project: ${known.join(', ')}` } : {}),
        },
      });
      return null;
    }
    return rt;
  };

  router.get('/', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      res.json({ tree: await rt.pages.listTree() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 0.2.13 (tier C) — the `rest` rendering of `list_pages`.
   *
   * Sibling of `GET /` rather than a replacement for it: that one answers the
   * TREE the sidebar renders, this one the core's flat, paged listing with
   * `prefix`/`sort` and a `total`/`hasMore` envelope. Both are `list_pages`
   * projections; the difference is a `view`, and giving it its own segment keeps
   * the UI's shape frozen while the catalog operation gets its own.
   *
   * Static segment, declared ahead of the read wildcard — a page literally named
   * `list` must not be able to shadow it.
   */
  router.get('/list', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      const prefix = typeof req.query.prefix === 'string' && req.query.prefix !== '' ? req.query.prefix : undefined;
      const sort = req.query.sort === 'modified' ? 'modified' : req.query.sort === 'path' ? 'path' : undefined;
      res.json(
        await discovery.listPages({
          rootId: rt.root.id,
          ...(prefix !== undefined ? { prefix } : {}),
          ...(sort !== undefined ? { sort } : {}),
          ...(positiveInt(req.query.limit) !== undefined ? { limit: positiveInt(req.query.limit) } : {}),
          ...(nonNegativeInt(req.query.offset) !== undefined ? { offset: nonNegativeInt(req.query.offset) } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * 0.2.13 (tier C) — the `rest` rendering of `get_page`.
   *
   * The read wildcard below is not it, and the difference is not cosmetic. That
   * one answers `PagesService.read` — the editor's payload — with a bare
   * `{ error: 'not found' }` for a missing page and no notion of `range`. This
   * answers the core: the page AS AUTHORED with its XML tags untouched, a
   * `PAGE_NOT_FOUND` carrying the repair path, and `range` — which the core
   * accepts only on a root WITHOUT a section index, a refusal it owns because it
   * owns root properties.
   *
   * The path is a QUERY parameter, not a wildcard segment. A page path contains
   * slashes and may collide with any static segment this router adds later; put
   * it in the query and the operation's route can never be shadowed by a page
   * whose name happens to match.
   */
  router.get('/get', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      const pagePath = typeof req.query.path === 'string' ? req.query.path : '';
      if (!pagePath) throw new DomainError('VALIDATION', 'path query param required');
      const range = parseRange(req.query.range);
      res.json(
        await discovery.getPage({ rootId: rt.root.id, path: pagePath, ...(range ? { range } : {}) }),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * Text search over page content (query param `q`) — a FILE SCAN, not an index.
   *
   * There is no full-text index of page content anywhere in this system: no FTS
   * table, no derived structure holding the text. Every call rereads the
   * markdown of this root, line by line, with no cache between calls. Cost grows
   * linearly with the number and size of pages, and narrowing the scope (the
   * root, which is already in the path here) is the only input-side lever on it.
   *
   * Agent-facing search semantics — regex, `hits`/`pages`/`count` modes,
   * pagination — belong to the M39 core operation `search_pages`. This endpoint
   * is the HTTP surface for the UI, not the MCP tool's contract, which is why
   * the two have different shapes and why this one is not the place to add
   * modes.
   */
  router.get('/search', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = Number(req.query.limit) || 50;
      const hits = await rt.pages.search(q, limit);
      res.json({ hits });
    } catch (err) {
      next(err);
    }
  });

  // 0.1.96: explicit create (CreatePageRequest { path, title?, content? }). See
  // the `clarification` patch — the body shape was not enumerated in the brief.
  //
  // 0.2.26: `title` joined the body, and an omitted `content` now yields the
  // default template (frontmatter with `title`) rather than a zero-byte file.
  // The rule lives in `createPage`, so MCP and CLI got it at the same moment.
  //
  // 0.2.13 (tier C-3): the contract itself moved to `services/page-write.ts`.
  // This handler is now what the catalog says a channel is — an adapter that
  // parses a wire format, calls the owning function and maps the result back.
  // `PAGE_EXISTS` travels as a `DomainError` through the shared `errorHandler`,
  // which is why the hand-rolled 409 is gone rather than merely moved.
  router.post('/', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      const body = (req.body ?? {}) as { path?: string; title?: string; content?: string };
      const result = await createPage(
        rt,
        {
          path: typeof body.path === 'string' ? body.path : '',
          ...(typeof body.title === 'string' ? { title: body.title } : {}),
          ...(body.content !== undefined ? { content: body.content } : {}),
        },
        'user',
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/*', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      const relPath = (req.params as Record<string, string>)[0];
      if (!relPath) return res.status(400).json({ error: 'missing path' });
      // M17: page version history — `GET /api/pages/:rootId/<path>?versions=true`.
      if (req.query.versions === 'true' && pageVersions) {
        const versions = pageVersions.listVersions(relPath, rt.root.id);
        return res.json({ path: relPath, versions });
      }
      // M17: page version detail — `?versionDetail=N`.
      if (req.query.versionDetail != null && pageVersions) {
        const version = Number(req.query.versionDetail);
        if (!Number.isFinite(version) || version <= 0) {
          return res.status(400).json({ error: 'invalid versionDetail' });
        }
        const detail = pageVersions.getVersion(relPath, version, rt.root.id);
        if (!detail) return res.status(404).json({ error: 'version not found' });
        return res.json(detail);
      }
      if (!(await rt.pages.exists(relPath))) return res.status(404).json({ error: 'not found' });
      res.json(await rt.pages.read(relPath));
    } catch (err) {
      next(err);
    }
  });

  router.put('/*', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      const relPath = (req.params as Record<string, string>)[0];
      if (!relPath) return res.status(400).json({ error: 'missing path' });
      const body = (req.body ?? {}) as {
        body?: string;
        frontmatter?: Record<string, unknown>;
        /** M02 m02octconc: optional sha256 hex of full file content known to client. Mismatch → 409 PAGE_CONFLICT. */
        expectedHash?: string;
      };
      res.json(
        await updatePage(
          rt,
          {
            path: relPath,
            body: body.body as string,
            ...(body.frontmatter !== undefined ? { frontmatter: body.frontmatter } : {}),
            ...(body.expectedHash !== undefined ? { expectedHash: body.expectedHash } : {}),
          },
          'user',
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * 0.2.37 — `PATCH`, the DIFFERENTIAL rendering of `update_page`, on the same
   * path as the `PUT` above.
   *
   * Two REST routes for one catalog operation, which the L3 rule now allows
   * exactly here: the two input modes have disjoint HTTP semantics — `PUT` sets
   * a target state, `PATCH` modifies an existing one — and both call the SAME
   * core function and answer the same shape. It is one entity in two
   * renderings, not two operations, and the moment either handler decides
   * something the other does not, that claim stops being true.
   */
  router.patch('/*', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      const relPath = (req.params as Record<string, string>)[0];
      if (!relPath) return res.status(400).json({ error: 'missing path' });
      const body = (req.body ?? {}) as {
        textEdits?: TextEdit[];
        expectedHash?: string;
        dropAnchors?: string[];
      };
      /**
       * `textEdits` is forwarded VERBATIM — present when the caller sent it,
       * absent when it did not — so the core answers every refusal rather than
       * this adapter inventing one of its own. Substituting `[]` for an absent
       * field would look harmless and would silently retire the core's "neither
       * body nor textEdits" branch, leaving an empty PATCH to be refused for the
       * shape of its array instead of for what it forgot to say.
       */
      const diffDeps: PageDiffDeps = {
        ...(writeDeps ?? {}),
        sectionIndexed: rt.root.sectionIndexed,
      };
      res.json(
        await updatePage(
          rt,
          {
            path: relPath,
            ...(body.textEdits !== undefined ? { textEdits: body.textEdits as TextEdit[] } : {}),
            ...(body.expectedHash !== undefined ? { expectedHash: body.expectedHash } : {}),
            ...(Array.isArray(body.dropAnchors) ? { dropAnchors: body.dropAnchors } : {}),
          },
          'user',
          diffDeps,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.delete('/*', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      const relPath = (req.params as Record<string, string>)[0];
      if (!relPath) return res.status(400).json({ error: 'missing path' });
      res.json(await deletePage(rt, { path: relPath }, 'user'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * 0.2.13 (tier C) — the shared handler, replacing a local catch-all that
   * answered `500 { error: <string> }` for everything.
   *
   * The catch-all had to go for the new routes to work at all: `/get` refuses a
   * malformed `range` with `DomainError('VALIDATION')`, and the catch-all turned
   * that into a 500 — a caller's typo reported as a server fault, with the
   * repair path dropped.
   *
   * It is a REPLACEMENT rather than a layer above it, because the shape it
   * produced was already unreadable to the only client there is: `api-core.ts`
   * reads `body.error.message` and `body.error.code`, so a bare string yielded
   * `HTTP_ERROR` plus the status text and the real message was thrown away. Every
   * other router in the process uses this handler; this one was the exception.
   */
  router.use(errorHandler);

  return router;
}

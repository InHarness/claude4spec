import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PagesService } from '../services/pages.js';
import type { SelfWriteMarker } from '../fs/sources.js';
import type { FileVersionService } from '../services/file-version.js';
import type { Root } from '../../shared/types.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { errorHandler } from './errors.js';
import { nonNegativeInt, positiveInt } from './query-params.js';

/** 0.1.96: per-root runtime resolved from the `:rootId` path segment. */
export interface PageRootRuntime {
  root: Root;
  pages: PagesService;
  writer: SelfWriteMarker | null;
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
): Router {
  // mergeParams so the mount-level `:rootId` is visible inside this router.
  const router = Router({ mergeParams: true });

  const resolve = (req: Request, res: Response): PageRootRuntime | null => {
    const rootId = (req.params as Record<string, string>).rootId ?? '';
    const rt = resolveRoot(rootId);
    if (!rt) {
      res.status(404).json({ error: { code: 'ROOT_NOT_FOUND', message: `root '${rootId}' not found` } });
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

  // 0.1.96: explicit create (CreatePageRequest { path, content? }). See the
  // `clarification` patch — the body shape was not enumerated in the brief.
  router.post('/', async (req, res, next) => {
    try {
      const rt = resolve(req, res);
      if (!rt) return;
      const body = (req.body ?? {}) as { path?: string; content?: string };
      const relPath = typeof body.path === 'string' ? body.path : '';
      if (!relPath) return res.status(400).json({ error: 'path required' });
      if (await rt.pages.exists(relPath)) {
        return res.status(409).json({ error: { code: 'PAGE_EXISTS', message: `page '${relPath}' already exists` } });
      }
      // M40: label the write, then drive its reactions to completion. `capture`
      // (M17) is the sole author of `file_version`, so the version row must
      // exist before we respond — that is what `flush` guarantees.
      rt.writer?.markOrigin(relPath, 'user');
      const result = await rt.pages.write(relPath, { body: body.content ?? '' });
      await rt.writer?.flush(relPath);
      const writtenAbs = path.join(rt.pages.root, relPath);
      const writtenRaw = await fs.readFile(writtenAbs, 'utf-8');
      const newHash = crypto.createHash('sha256').update(writtenRaw, 'utf-8').digest('hex');
      res.status(201).json({ ...result, hash: newHash });
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
      if (typeof body.body !== 'string') return res.status(400).json({ error: 'body required' });
      const existed = await rt.pages.exists(relPath);

      // Optimistic concurrency check — backward compatible.
      if (typeof body.expectedHash === 'string' && existed) {
        const abs = path.join(rt.pages.root, relPath);
        const currentRaw = await fs.readFile(abs, 'utf-8');
        const currentHash = crypto.createHash('sha256').update(currentRaw, 'utf-8').digest('hex');
        if (currentHash !== body.expectedHash) {
          return res.status(409).json({
            error: { code: 'PAGE_CONFLICT', message: 'page changed since last read' },
            currentHash,
          });
        }
      }

      rt.writer?.markOrigin(relPath, 'user');
      const result = await rt.pages.write(relPath, { body: body.body, frontmatter: body.frontmatter });
      await rt.writer?.flush(relPath);
      const writtenAbs = path.join(rt.pages.root, relPath);
      const writtenRaw = await fs.readFile(writtenAbs, 'utf-8');
      const newHash = crypto.createHash('sha256').update(writtenRaw, 'utf-8').digest('hex');
      res.json({ ...result, hash: newHash });
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
      let lastContent: string | undefined;
      if (pageVersions && (await rt.pages.exists(relPath))) {
        try {
          lastContent = await fs.readFile(path.join(rt.pages.root, relPath), 'utf-8');
        } catch {
          /* ignore */
        }
      }
      // Deletes go through the same markOrigin + flush path as every other server
      // write. They must NOT suppress: a suppress token issued here has no event
      // of its own to be consumed by if the file is re-created immediately, and
      // would then swallow that re-create (no version row at all). `capture`
      // authors the tombstone, synthesizing the content from the last version.
      rt.writer?.markOrigin(relPath, 'user');
      await rt.pages.remove(relPath);
      await rt.writer?.flush(relPath, 'unlink');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return router;
}

import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PagesService } from '../services/pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import type { PageVersionService } from '../services/page-version.js';
import type { Root } from '../../shared/types.js';

/** 0.1.96: per-root runtime resolved from the `:rootId` path segment. */
export interface PageRootRuntime {
  root: Root;
  pages: PagesService;
  watcher: PagesWatcher | null;
}

/**
 * 0.1.96: pages router is mounted at `/pages/:rootId`. Each handler resolves the
 * target root's runtime via `resolveRoot(req.params.rootId)`; an unknown id →
 * 404 ROOT_NOT_FOUND (no fallback). The `page_version` store is shared across
 * roots and keyed by (rootId, path).
 */
export function pagesRouter(
  resolveRoot: (rootId: string) => PageRootRuntime | undefined,
  pageVersions: PageVersionService | null = null,
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
      rt.watcher?.suppress(relPath);
      const result = await rt.pages.write(relPath, { body: body.content ?? '' });
      if (pageVersions) {
        try {
          await pageVersions.recordVersion(relPath, 'create', 'user', undefined, undefined, rt.root.id);
        } catch (err) {
          console.warn(`[page-version] create capture failed for ${relPath}:`, (err as Error).message);
        }
      }
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

      rt.watcher?.suppress(relPath);
      const result = await rt.pages.write(relPath, { body: body.body, frontmatter: body.frontmatter });
      if (pageVersions) {
        try {
          await pageVersions.recordVersion(relPath, existed ? 'update' : 'create', 'user', undefined, undefined, rt.root.id);
        } catch (err) {
          console.warn(`[page-version] capture failed for ${relPath}:`, (err as Error).message);
        }
      }
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
      rt.watcher?.suppress(relPath);
      await rt.pages.remove(relPath);
      if (pageVersions) {
        try {
          await pageVersions.recordVersion(relPath, 'delete', 'user', lastContent, undefined, rt.root.id);
        } catch (err) {
          console.warn(`[page-version] delete capture failed for ${relPath}:`, (err as Error).message);
        }
      }
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

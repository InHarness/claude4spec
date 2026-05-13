import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PagesService } from '../services/pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import type { PageVersionService } from '../services/page-version.js';

export function pagesRouter(
  pages: PagesService,
  watcher: PagesWatcher | null,
  pageVersions: PageVersionService | null = null,
): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json({ tree: await pages.listTree() });
    } catch (err) {
      next(err);
    }
  });

  router.get('/search', async (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = Number(req.query.limit) || 50;
      const hits = await pages.search(q, limit);
      res.json({ hits });
    } catch (err) {
      next(err);
    }
  });

  router.get('/*', async (req, res, next) => {
    try {
      const relPath = (req.params as Record<string, string>)[0];
      if (!relPath) return res.status(400).json({ error: 'missing path' });
      // M17: page version history endpoint — `GET /api/pages/<path>?versions=true`.
      if (req.query.versions === 'true' && pageVersions) {
        if (!(await pages.exists(relPath))) {
          // Allow listing versions for a deleted page if any rows exist
          const versions = pageVersions.listVersions(relPath);
          return res.json({ path: relPath, versions });
        }
        return res.json({ path: relPath, versions: pageVersions.listVersions(relPath) });
      }
      // M17: page version detail endpoint — `GET /api/pages/<path>?versionDetail=N`.
      if (req.query.versionDetail != null && pageVersions) {
        const version = Number(req.query.versionDetail);
        if (!Number.isFinite(version) || version <= 0) {
          return res.status(400).json({ error: 'invalid versionDetail' });
        }
        const detail = pageVersions.getVersion(relPath, version);
        if (!detail) return res.status(404).json({ error: 'version not found' });
        return res.json(detail);
      }
      if (!(await pages.exists(relPath))) return res.status(404).json({ error: 'not found' });
      res.json(await pages.read(relPath));
    } catch (err) {
      next(err);
    }
  });

  router.put('/*', async (req, res, next) => {
    try {
      const relPath = (req.params as Record<string, string>)[0];
      if (!relPath) return res.status(400).json({ error: 'missing path' });
      const body = (req.body ?? {}) as {
        body?: string;
        frontmatter?: Record<string, unknown>;
        /** M02 m02octconc: optional sha256 hex of full file content known to client. Mismatch → 409 PAGE_CONFLICT. */
        expectedHash?: string;
      };
      if (typeof body.body !== 'string') return res.status(400).json({ error: 'body required' });
      const existed = await pages.exists(relPath);

      // Optimistic concurrency check — backward compatible: jezeli klient nie
      // przeslal `expectedHash`, write idzie bez sprawdzenia (stary kontrakt).
      // Spec m02octconc: M21 brief PUT zawsze przesle hash, pages opcjonalnie.
      if (typeof body.expectedHash === 'string' && existed) {
        const abs = path.join(pages.root, relPath);
        const currentRaw = await fs.readFile(abs, 'utf-8');
        const currentHash = crypto.createHash('sha256').update(currentRaw, 'utf-8').digest('hex');
        if (currentHash !== body.expectedHash) {
          return res.status(409).json({
            error: { code: 'PAGE_CONFLICT', message: 'page changed since last read' },
            currentHash,
          });
        }
      }

      watcher?.suppress(relPath);
      const result = await pages.write(relPath, { body: body.body, frontmatter: body.frontmatter });
      // M17: capture page_version (origin: user via REST PUT)
      if (pageVersions) {
        try {
          await pageVersions.recordVersion(relPath, existed ? 'update' : 'create', 'user');
        } catch (err) {
          console.warn(`[page-version] capture failed for ${relPath}:`, (err as Error).message);
        }
      }
      // Compute hash of newly-written content, return so klient ma świeży anchor
      // dla kolejnego PUT bez konieczności GET.
      const writtenAbs = path.join(pages.root, relPath);
      const writtenRaw = await fs.readFile(writtenAbs, 'utf-8');
      const newHash = crypto.createHash('sha256').update(writtenRaw, 'utf-8').digest('hex');
      res.json({ ...result, hash: newHash });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/*', async (req, res, next) => {
    try {
      const relPath = (req.params as Record<string, string>)[0];
      if (!relPath) return res.status(400).json({ error: 'missing path' });
      // M17: capture last content before deletion as tombstone
      let lastContent: string | undefined;
      if (pageVersions && (await pages.exists(relPath))) {
        try {
          const fs = await import('node:fs/promises');
          const path = await import('node:path');
          lastContent = await fs.readFile(path.join(pages.root, relPath), 'utf-8');
        } catch {
          /* ignore */
        }
      }
      watcher?.suppress(relPath);
      await pages.remove(relPath);
      if (pageVersions) {
        try {
          await pageVersions.recordVersion(relPath, 'delete', 'user', lastContent);
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

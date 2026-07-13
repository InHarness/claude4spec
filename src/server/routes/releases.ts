import { Router } from 'express';
import type { ReleaseService } from '../services/release.js';
import type { GitService } from '../services/git.js';
import type { WsEmitter } from '../ws/project-emitter.js';

export function releasesRouter(
  releases: ReleaseService,
  ws?: WsEmitter,
  gitService?: GitService,
): Router {
  const router = Router();

  router.get('/', (_req, res, next) => {
    try {
      res.json({ releases: releases.listReleases() });
    } catch (err) {
      next(err);
    }
  });

  // Literal path — MUST be declared before the `/:idOrName` catch-all.
  router.get('/unreleased-count', (_req, res, next) => {
    try {
      res.json({ count: releases.countUnreleased() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { name?: string; description?: string };
      const release = releases.createRelease(
        { name: body.name ?? '', description: body.description ?? '' },
        'user',
      );
      ws?.broadcast({ kind: 'release:created', releaseId: release.id, name: release.name });
      // M28: best-effort git commit AFTER the release is persisted. Non-fatal —
      // gitSync rides this synchronous response (null when off / no repo) and a
      // failure surfaces as a warning toast, never blocking release creation.
      const gitSync = gitService ? await gitService.commitOnRelease(release) : null;
      res.status(201).json({ ...release, gitSync });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:idOrName', (req, res, next) => {
    try {
      const release = releases.getRelease(decodeIdOrName(req.params.idOrName));
      res.json(release);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:idOrName', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        name?: string;
        description?: string;
        assignUnreleased?: boolean;
      };
      const release = releases.updateRelease({
        idOrName: decodeIdOrName(req.params.idOrName),
        name: body.name,
        description: body.description,
        assignUnreleased: body.assignUnreleased,
      });
      ws?.broadcast({ kind: 'release:updated', releaseId: release.id, name: release.name });
      res.json(release);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Internal-only consumer: konsumowane wyłącznie przez stronę release detail
   * (UI L5) do renderowania kart `single_element` w stanie `from` dla deleted
   * entities. Nie jest portowalnym eksportem JSON-a — moduł linearizacji
   * (przyszły) doda swoje własne API.
   */
  router.get('/:idOrName/snapshot', (req, res, next) => {
    try {
      const snap = releases.getReleaseSnapshot(decodeIdOrName(req.params.idOrName));
      res.json(snap);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:from/diff/:to', async (req, res, next) => {
    try {
      const fromParam =
        req.params.from === '__INITIAL__' ? null : decodeIdOrName(req.params.from);
      // 0.1.96 (L13): narrow the pages dimension to the requested root(s). Express
      // gives a string for `?roots=pages` and an array for `?roots=pages&roots=skills`;
      // normalize both to `string[]`. Absent/empty ⇒ undefined ⇒ all releasable roots
      // (unchanged behaviour for the release-detail diff view). Backs the brief-scope
      // picker's per-root changed-page count probe.
      const rawRoots = req.query.roots;
      const roots = (Array.isArray(rawRoots) ? rawRoots : rawRoots === undefined ? [] : [rawRoots])
        .filter((r): r is string => typeof r === 'string');
      // 0.1.122: reserved literal `:to === 'current'` resolved BEFORE the
      // nameOrId lookup — diff `:from` against the live/unreleased spec state.
      if (req.params.to === 'current') {
        const delta = await releases.getUnreleasedDiff(fromParam, {
          roots: roots.length > 0 ? roots : undefined,
        });
        res.json(delta);
        return;
      }
      const delta = await releases.getReleaseDiff(fromParam, decodeIdOrName(req.params.to), {
        roots: roots.length > 0 ? roots : undefined,
      });
      res.json(delta);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:idOrName/restore', async (req, res, next) => {
    try {
      const releaseId = decodeIdOrName(req.params.idOrName);
      const body = (req.body ?? {}) as {
        scope?: 'entity' | 'page' | 'spec';
        target?: { type?: string; slug?: string; path?: string };
      };
      const scope = body.scope ?? 'spec';
      if (scope === 'entity') {
        const target = body.target ?? {};
        if (!target.type || !target.slug) {
          return res.status(400).json({
            error: { code: 'VALIDATION', message: 'scope=entity requires target.type + target.slug' },
          });
        }
        const result = releases.restoreEntity({
          type: target.type as Parameters<typeof releases.restoreEntity>[0]['type'],
          slug: target.slug,
          releaseId,
        });
        res.json(result);
        return;
      }
      if (scope === 'page') {
        const target = body.target ?? {};
        if (!target.path) {
          return res.status(400).json({
            error: { code: 'VALIDATION', message: 'scope=page requires target.path' },
          });
        }
        const result = await releases.restorePage({ path: target.path, releaseId });
        res.json(result);
        return;
      }
      // scope === 'spec' (default)
      const result = await releases.restoreSpec({ releaseId });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function decodeIdOrName(value: string | undefined): number | string {
  if (!value) throw new Error('missing release id or name');
  // numeric string => id, otherwise name
  if (/^\d+$/.test(value)) return Number(value);
  return decodeURIComponent(value);
}

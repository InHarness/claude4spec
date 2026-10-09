import { Router, type Request } from 'express';
import type { ReleaseService } from '../services/release.js';
import type { GitService } from '../services/git.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { CURRENT_RELEASE_NAME } from '../../shared/entities.js';
import type { Root } from '../../shared/types.js';
import { DomainError } from '../services/tags.js';
import {
  INCLUDE_VALUES,
  releaseDiffOperation,
  releaseListOperation,
  releaseShowOperation,
  resolveDiffRange,
  type ReleaseOperationDeps,
} from '../services/release-operations.js';
import type { IncludeFilter } from '../mcp/release-tools/types.js';

export function releasesRouter(
  releases: ReleaseService,
  ws?: WsEmitter,
  gitService?: GitService,
  /**
   * 2.1.8: the project's PAGE roots (`kind: pages`) — what a `roots`/`paths`
   * filter of `view=operation` may name. Defaults to the release service's own
   * page-root ids, so a rig that wires no registry still refuses a system root.
   */
  roots: () => ReadonlyArray<Pick<Root, 'id'>> = () => releases.pageRootIds().map((id) => ({ id })),
): Router {
  const router = Router();
  const opDeps: ReleaseOperationDeps = { releaseService: releases, roots };

  /*
   * 2.1.11 — `view=operation` answers `{ data: <operation payload> }`, the same
   * payload the MCP tool returns for the same parameters (`release_list`). Without
   * `view` the route keeps its UI projection, and an operation parameter there is
   * a 400 rather than a silent fall-back to the default projection.
   */
  router.get('/', (req, res, next) => {
    try {
      if (readView(req, LIST_PARAMS)) {
        res.json({ data: releaseListOperation(opDeps, { limit: intParam(req, 'limit'), offset: intParam(req, 'offset') }) });
        return;
      }
      res.json({ releases: releases.listReleases() });
    } catch (err) {
      next(err);
    }
  });

  // Literal path — MUST be declared before the `/:name` catch-all.
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

  router.get('/:name', (req, res, next) => {
    try {
      const release = releases.getRelease(releaseNameParam(req.params.name));
      res.json(release);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:name', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        name?: string;
        description?: string;
        assignUnreleased?: boolean;
      };
      // 0.1.124: async — assignUnreleased may run a best-effort `commitPull`
      // BEFORE assigning the SQLite release_id cache (commit-then-assign, see
      // ReleaseService.updateRelease's doc comment); gitSync rides this
      // response the same way it does on `POST /api/releases`.
      const release = await releases.updateRelease({
        releaseName: releaseNameParam(req.params.name),
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
  router.get('/:name/snapshot', (req, res, next) => {
    try {
      if (readView(req, SHOW_PARAMS)) {
        const data = releaseShowOperation(opDeps, {
          releaseName: releaseNameParam(req.params.name),
          include: listParam(req, 'include') as IncludeFilter[] | undefined,
          entityTypes: listParam(req, 'entityTypes'),
          limit: intParam(req, 'limit'),
          offset: intParam(req, 'offset'),
        });
        res.json({ data });
        return;
      }
      const snap = releases.getReleaseSnapshot(releases.resolveReleaseId(releaseNameParam(req.params.name)));
      res.json(snap);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:from/diff/:to', async (req, res, next) => {
    try {
      // 2.1.11 — `:from` takes `initial` / `null` for the empty state, `:to` takes
      // `current` for HEAD. Both projections share the literal matrix with the
      // operation, so `initial → current` is a 400 here too, `view` or not.
      const fromSeg = req.params.from;
      const toSeg = req.params.to;
      if (readView(req, DIFF_PARAMS)) {
        const data = await releaseDiffOperation(opDeps, {
          fromReleaseName: releaseNameParam(fromSeg),
          toReleaseName: releaseNameParam(toSeg),
          include: listParam(req, 'include') as IncludeFilter[] | undefined,
          entityTypes: listParam(req, 'entityTypes'),
          slugs: listParam(req, 'slugs'),
          roots: listParam(req, 'roots'),
          paths: listParam(req, 'paths'),
          summaryOnly: boolParam(req, 'summaryOnly'),
          limit: intParam(req, 'limit'),
          offset: intParam(req, 'offset'),
          sectionOffset: intParam(req, 'sectionOffset'),
          sectionLimit: intParam(req, 'sectionLimit'),
        });
        res.json({ data });
        return;
      }
      // The raw projection (the UI's coloured diff) exposes no filters.
      const { from, to } = resolveDiffRange(releaseNameParam(fromSeg), releaseNameParam(toSeg));
      const toId = to === CURRENT_RELEASE_NAME ? null : releases.resolveReleaseId(to);
      const fromId = from === null ? null : releases.resolveReleaseId(from);
      res.json(toId === null ? await releases.getUnreleasedDiff(fromId) : await releases.getReleaseDiff(fromId, toId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:name/restore', async (req, res, next) => {
    try {
      // The name resolves to the technical id here; a literal or an unknown
      // name is a 404 before any restore runs.
      const releaseId = releases.resolveReleaseId(releaseNameParam(req.params.name));
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

/**
 * 2.1.11: a path segment is a release NAME, never an id — `12` is the release
 * named `12`. Express has already percent-decoded the segment (`team%2Fv1` →
 * `team/v1`), so decoding again would corrupt a name carrying `%`.
 */
function releaseNameParam(value: string | undefined): string {
  if (!value) throw new DomainError('VALIDATION', 'missing release name');
  return value;
}

/** The query keys each operation route reads under `view=operation` — its operation's parameters. */
const LIST_PARAMS = ['limit', 'offset'] as const;
const SHOW_PARAMS = ['include', 'entityTypes', 'limit', 'offset'] as const;
const DIFF_PARAMS = [
  'include',
  'entityTypes',
  'slugs',
  'roots',
  'paths',
  'summaryOnly',
  'limit',
  'offset',
  'sectionOffset',
  'sectionLimit',
] as const;
const VIEWS = ['operation'] as const;

/**
 * The route's `view`, enforced both ways: an unknown value is a 400, and so is
 * an operation parameter given WITHOUT `view=operation` — answering it with the
 * default projection would silently ignore a filter the caller asked for.
 * Returns true for `view=operation`.
 */
function readView(req: Request, operationParams: readonly string[]): boolean {
  const view = req.query.view;
  if (view !== undefined && (typeof view !== 'string' || !(VIEWS as readonly string[]).includes(view))) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `unknown view '${String(view)}' — this route accepts: ${VIEWS.join(', ')}`,
      'omit `view` for the default projection, or pass `view=operation` for the operation payload',
    );
  }
  if (view === 'operation') return true;
  const stray = operationParams.filter((p) => req.query[p] !== undefined);
  if (stray.length > 0) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `${stray.join(', ')} ${stray.length === 1 ? 'is a parameter' : 'are parameters'} of view=operation — the default projection takes none`,
      `add \`view=operation\` to the query to get the operation payload with these parameters`,
    );
  }
  return false;
}

/** A list parameter: the key repeated (`entityTypes=a&entityTypes=b`). Empty elements are kept and validated by the operation. */
function listParam(req: Request, key: string): string[] | undefined {
  const raw = req.query[key];
  if (raw === undefined) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  if (!values.every((v): v is string => typeof v === 'string')) {
    throw new DomainError('INVALID_ARGUMENT', `${key} must be a list of strings, given as the repeated key ${key}=a&${key}=b`);
  }
  if (key === 'include') {
    const bad = values.filter((v) => !(INCLUDE_VALUES as readonly string[]).includes(v));
    if (bad.length > 0) {
      throw new DomainError('INVALID_ARGUMENT', `include: unknown value(s) ${bad.join(', ')} — expected ${INCLUDE_VALUES.join(', ')}`);
    }
  }
  return values;
}

function intParam(req: Request, key: string): number | undefined {
  const raw = req.query[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) {
    throw new DomainError('INVALID_ARGUMENT', `${key} must be an integer`);
  }
  return Number(raw);
}

function boolParam(req: Request, key: string): boolean | undefined {
  const raw = req.query[key];
  if (raw === undefined) return undefined;
  if (raw !== 'true' && raw !== 'false') {
    throw new DomainError('INVALID_ARGUMENT', `${key} must be true or false`);
  }
  return raw === 'true';
}

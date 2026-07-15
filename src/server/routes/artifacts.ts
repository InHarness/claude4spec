import { Router } from 'express';
import type { BriefService } from '../services/brief.js';
import type { PatchService } from '../services/patch.js';
import type { PlanService } from '../services/plan.js';
import type { FileVersionService } from '../services/file-version.js';
import { artifactRegistry, type ArtifactKind } from '../services/artifact-registry.js';
import type {
  ArtifactListItem,
  ArtifactResponse,
  PatchStatus,
} from '../../shared/entities.js';
import { DomainError } from '../services/tags.js';

/**
 * M36 — generic REST family replacing the per-kind `/api/briefs/*`/`/api/patches/*`
 * routes (7 endpoints, parametrized by `:kind`). `BriefService`/`PatchService`/
 * `PlanService` stay the kind-specific implementations (each has its own
 * creation flow / query-filter semantics that don't generalize cleanly) — this
 * router is a thin adapter layer translating each service's internal shape to
 * the generic `ArtifactResponse`/`ArtifactListItem` DTOs at the REST boundary.
 *
 * `plan`'s generic `/api/artifacts/plan/*` endpoints (list/detail/versions/
 * content/frontmatter) replace the pre-0.1.127 bespoke `GET /api/plans`,
 * `GET/PUT/PATCH /api/plans/:planId` routes — but `plan`'s own thread-binding
 * flows (`create-thread`, `execute`, `last-thread`, `by-thread`) stay bespoke
 * in `routes/plans.ts` (richer semantics than the generic `POST .../threads`:
 * `execute`'s two modes, `initialMessage`, etc.), so this adapter's
 * `createThread`/`listThreads` exist only to satisfy `ArtifactKindAdapter` —
 * they delegate to the exact same `PlanService` methods `routes/plans.ts`
 * calls, so there's no behavior fork between the two paths.
 */
interface ArtifactKindAdapter {
  list(query: Record<string, unknown>): ArtifactListItem[];
  get(path: string): Promise<ArtifactResponse>;
  /** Both kinds' old detail routes merged `threads` into the response body
   *  (`{ ...detail, threads }`) — preserved here rather than dropped, since
   *  client detail pages read `.threads` off the same call. */
  listThreads(path: string): Array<{ id: string; title: string | null; updatedAt: string; messageCount?: number }>;
  updateContent(path: string, content: string, expectedHash: string): Promise<ArtifactResponse>;
  updateFrontmatter(path: string, frontmatter: Record<string, unknown>): Promise<ArtifactResponse>;
  createThread(path: string, name?: string | null): Promise<{ threadId: string }>;
}

export interface ArtifactsRouterDeps {
  brief: BriefService;
  patch: PatchService;
  plan: PlanService;
  pageVersions: FileVersionService;
}


function buildBriefAdapter(deps: ArtifactsRouterDeps): ArtifactKindAdapter {
  const { brief: briefs } = deps;
  return {
    list(query) {
      let implemented: boolean | undefined;
      if (query.implemented === undefined) {
        implemented = undefined;
      } else if (query.implemented === 'true') {
        implemented = true;
      } else if (query.implemented === 'false') {
        implemented = false;
      } else {
        throw new DomainError('VALIDATION', `?implemented must be 'true' or 'false' (omit for all)`);
      }
      // Maps listBriefs()'s already-fetched frontmatter/hash directly — no
      // second frontmatter-indexer lookup or file_version query per row.
      return briefs.listBriefs({ implemented }).map((item) => ({
        path: item.path,
        frontmatter: item.frontmatter,
        hash: item.hash,
        updatedAt: item.lastModifiedAt,
      }));
    },
    async get(path) {
      const b = await briefs.getBrief(path);
      return { path: b.path, frontmatter: b.frontmatter, body: b.body, content: b.content, hash: b.hash };
    },
    async updateContent(path, content, expectedHash) {
      await briefs.updateContent({ path, content, expectedHash, changedBy: 'user' });
      const b = await briefs.getBrief(path);
      return { path: b.path, frontmatter: b.frontmatter, body: b.body, content: b.content, hash: b.hash };
    },
    async updateFrontmatter(path, frontmatter) {
      const implemented =
        typeof frontmatter.implemented === 'boolean' ? frontmatter.implemented : undefined;
      const b = await briefs.updateFrontmatter({ path, patch: { implemented }, changedBy: 'user' });
      return { path: b.path, frontmatter: b.frontmatter, body: b.body, content: b.content, hash: b.hash };
    },
    createThread(path, name) {
      return Promise.resolve(briefs.createThreadForBrief({ path, name: name ?? null }));
    },
    listThreads(path) {
      return briefs.listThreadsForBrief(path);
    },
  };
}

function buildPatchAdapter(deps: ArtifactsRouterDeps): ArtifactKindAdapter {
  const { patch: patches } = deps;
  return {
    list(query) {
      const brief = typeof query.brief === 'string' ? query.brief : undefined;
      let status: PatchStatus | undefined;
      if (query.status === undefined) {
        status = undefined;
      } else if (query.status === 'awaiting' || query.status === 'completed') {
        status = query.status;
      } else {
        throw new DomainError('VALIDATION', `?status must be 'awaiting' or 'completed' (omit for all)`);
      }
      // Maps listPatches()'s already-fetched frontmatter/hash directly — no
      // second frontmatter-indexer lookup or file_version query per row.
      return patches.listPatches({ brief, status }).map((item) => ({
        path: item.path,
        frontmatter: item.frontmatter,
        hash: item.hash,
        updatedAt: item.lastModified,
      }));
    },
    async get(path) {
      const p = await patches.getPatch(path);
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    async updateContent(path, content, expectedHash) {
      const p = await patches.updateContent({ path, content, expectedHash });
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    async updateFrontmatter(path, frontmatter) {
      if (frontmatter.status !== 'awaiting' && frontmatter.status !== 'completed') {
        throw new DomainError('VALIDATION', "status must be 'awaiting' or 'completed'");
      }
      const p = await patches.updateFrontmatter({ path, status: frontmatter.status });
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    createThread(path, name) {
      return patches.createThreadForPatch(path, name ?? null);
    },
    listThreads(path) {
      return patches.listThreadsForPatch(path);
    },
  };
}

function buildPlanAdapter(deps: ArtifactsRouterDeps): ArtifactKindAdapter {
  const { plan: plans } = deps;
  return {
    list(query) {
      const search = typeof query.search === 'string' ? query.search : undefined;
      // Maps listPlans()'s already-fetched frontmatter/hash directly — no
      // second frontmatter-indexer lookup or file_version query per row.
      return plans.listPlans({ search }).map((item) => ({
        path: item.path,
        frontmatter: item.frontmatter,
        hash: item.hash,
        updatedAt: item.updatedAt,
      }));
    },
    async get(path) {
      const p = await plans.getByPath(path);
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    async updateContent(path, content, expectedHash) {
      await plans.updateContent({ path, content, expectedHash, changedBy: 'user' });
      const p = await plans.getByPath(path);
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    async updateFrontmatter(path, frontmatter) {
      const title = typeof frontmatter.title === 'string' ? frontmatter.title : undefined;
      const p = await plans.updateFrontmatter({ path, patch: { title }, changedBy: 'user' });
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    // Not the client's actual creation path (see file header) — delegates to
    // the same PlanService method the bespoke POST /api/plans/:slug/create-thread
    // route uses, so there's no behavior fork if a caller does reach this route.
    createThread(path) {
      return plans.attachThreadToPlan(path);
    },
    listThreads(path) {
      return plans.listThreadsForPlan(path);
    },
  };
}

/**
 * Express splat (`/*`) puts ONLY the matched wildcard portion in
 * `req.params[0]`. Literal segments (`/versions`, `:version`, etc.) are
 * stripped automatically.
 */
function extractPath(params: unknown): string {
  const splat = (params as Record<string, string>)[0];
  if (!splat) throw new DomainError('VALIDATION', 'missing artifact path');
  return splat;
}

export function artifactsRouter(deps: ArtifactsRouterDeps): Router {
  const adapters: Record<ArtifactKind, ArtifactKindAdapter> = {
    brief: buildBriefAdapter(deps),
    patch: buildPatchAdapter(deps),
    plan: buildPlanAdapter(deps),
  };

  const router = Router();

  router.param('kind', (req, res, next, kind) => {
    if (!(kind in adapters)) {
      return next(new DomainError('UNKNOWN_ARTIFACT_KIND', `unknown artifact kind '${kind}'`));
    }
    next();
  });

  // GET /api/artifacts/:kind — list (per-kind query filters: ?implemented= for
  // brief, ?brief=/?status= for patch).
  router.get('/:kind', (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      res.json({ data: adapters[kind].list(req.query as Record<string, unknown>) });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/artifacts/:kind/<path>/versions
  router.get('/:kind/*/versions', (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const versions = deps.pageVersions.listVersions(path, artifactRegistry[kind].rootId);
      res.json({ data: versions });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/artifacts/:kind/<path>/versions/:version
  router.get('/:kind/*/versions/:version', (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const version = Number(req.params.version);
      if (!Number.isInteger(version) || version <= 0) {
        throw new DomainError('VALIDATION', 'version must be a positive integer');
      }
      const path = extractPath(req.params);
      const detail = deps.pageVersions.getVersion(path, version, artifactRegistry[kind].rootId);
      if (!detail) throw new DomainError('VERSION_NOT_FOUND', `version ${version} not found`);
      res.json({ data: detail });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/artifacts/:kind/<path>/content — full replace, optimistic concurrency.
  router.put('/:kind/*/content', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const body = (req.body ?? {}) as { content?: string; expectedHash?: string };
      if (typeof body.content !== 'string') {
        throw new DomainError('VALIDATION', 'content is required');
      }
      if (typeof body.expectedHash !== 'string') {
        throw new DomainError('VALIDATION', 'expectedHash is required for content updates');
      }
      const out = await adapters[kind].updateContent(path, body.content, body.expectedHash);
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/artifacts/:kind/<path>/frontmatter — only keys in the kind's
  // frontmatterContract.mutable are accepted; anything else -> 400 IMMUTABLE_FIELD.
  router.patch('/:kind/*/frontmatter', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const body = (req.body ?? {}) as { frontmatter?: Record<string, unknown> };
      const frontmatter = body.frontmatter ?? {};
      const mutable = new Set(artifactRegistry[kind].frontmatterContract.mutable);
      const invalid = Object.keys(frontmatter).filter((k) => !mutable.has(k));
      if (invalid.length > 0) {
        throw new DomainError(
          'IMMUTABLE_FIELD',
          `cannot mutate immutable frontmatter keys: ${invalid.join(', ')} (mutable: ${[...mutable].join(', ')})`,
        );
      }
      const out = await adapters[kind].updateFrontmatter(path, frontmatter);
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/artifacts/:kind/<path>/threads
  router.post('/:kind/*/threads', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const body = (req.body ?? {}) as { name?: string };
      const result = await adapters[kind].createThread(path, body.name ?? null);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/artifacts/:kind/<path> — detail (must be LAST so the more
  // specific /versions, /content, /frontmatter, /threads routes match first).
  router.get('/:kind/*', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const data = await adapters[kind].get(path);
      const threads = adapters[kind].listThreads(path);
      res.json({ data: { ...data, threads } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

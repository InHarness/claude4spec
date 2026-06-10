import type { ProjectContext } from './project-context.js';
import type { ProjectRecord } from './types.js';

const FAILED_BUILD_TTL_MS = 15_000;
const DEFAULT_MAX_LIVE = 8;

type CacheEntry =
  | { state: 'building'; promise: Promise<ProjectContext> }
  | { state: 'ready'; ctx: ProjectContext; lastUsed: number }
  | { state: 'failed'; error: Error; at: number };

export class ProjectBuildFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectBuildFailedError';
  }
}

/**
 * M31: lazily-built, cached ProjectContexts — the heart of the workspace
 * model. One entry per project-id; singleflight build (concurrent requests
 * during a build share one promise); failed builds are cached ~15s so a
 * broken project 500s cheaply without hammering rebuilds while the process
 * keeps serving every other project.
 *
 * LRU budget: at most `maxLive` live contexts (env C4S_MAX_LIVE_PROJECTS).
 * Eviction only touches contexts with no in-flight agent turn — an active
 * project is never disposed; the budget is exceeded instead and eviction
 * retries when a turn completes (`reapIdle`, pinged via onTurnFinished).
 * `invalidate` parks the old context in a retired set, disposed when idle.
 */
export class ProjectContextCache {
  private entries = new Map<string, CacheEntry>();
  private retired = new Set<ProjectContext>();
  private readonly maxLive: number;

  constructor(
    private readonly build: (project: ProjectRecord) => Promise<ProjectContext>,
    maxLive?: number,
  ) {
    const fromEnv = Number(process.env.C4S_MAX_LIVE_PROJECTS);
    this.maxLive = maxLive ?? (Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_LIVE);
  }

  async get(project: ProjectRecord): Promise<ProjectContext> {
    const id = project.id;
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.state === 'building') return existing.promise;
      if (existing.state === 'ready') {
        existing.lastUsed = Date.now();
        return existing.ctx;
      }
      // failed — cached for a short window, then retry
      if (Date.now() - existing.at < FAILED_BUILD_TTL_MS) {
        throw new ProjectBuildFailedError(existing.error.message);
      }
      this.entries.delete(id);
    }

    this.evictIfOverBudget();

    const promise = this.build(project).then(
      (ctx) => {
        this.entries.set(id, { state: 'ready', ctx, lastUsed: Date.now() });
        return ctx;
      },
      (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.entries.set(id, { state: 'failed', error, at: Date.now() });
        throw new ProjectBuildFailedError(error.message);
      },
    );
    this.entries.set(id, { state: 'building', promise });
    return promise;
  }

  /** Live (ready) contexts — `live` flag in GET /api/workspace. */
  isLive(projectId: string): boolean {
    return this.entries.get(projectId)?.state === 'ready';
  }

  getLive(projectId: string): ProjectContext | null {
    const entry = this.entries.get(projectId);
    return entry?.state === 'ready' ? entry.ctx : null;
  }

  /**
   * Drop the entry (failed entries clear immediately; a ready context is
   * parked in `retired` and disposed once idle). The next request rebuilds.
   */
  invalidate(projectId: string): void {
    const entry = this.entries.get(projectId);
    this.entries.delete(projectId);
    if (entry?.state === 'ready') {
      this.retired.add(entry.ctx);
    }
    this.reapIdle();
  }

  /**
   * Purge path: drop the entry and AWAIT its dispose (unlike fire-and-forget
   * `invalidate`) so the db handle is closed before the caller `fs.rm`s the
   * slot dir. The caller guarantees no in-flight turn (409 otherwise).
   */
  async retire(projectId: string): Promise<void> {
    const entry = this.entries.get(projectId);
    this.entries.delete(projectId);
    if (entry?.state === 'ready') {
      await entry.ctx.dispose();
    } else if (entry?.state === 'building') {
      try {
        await (await entry.promise).dispose();
      } catch {
        /* build failed — nothing live to dispose */
      }
    }
  }

  /**
   * Dispose retired contexts whose agent turns have all finished. Called on
   * invalidate and from every turn's `finally` (onTurnFinished).
   */
  reapIdle(): void {
    for (const ctx of this.retired) {
      if (!ctx.hasInFlightTurn()) {
        this.retired.delete(ctx);
        ctx.dispose().catch((err) => {
          console.warn(`[context-cache] dispose of retired ${ctx.projectId} failed:`, err);
        });
      }
    }
    this.evictIfOverBudget();
  }

  private evictIfOverBudget(): void {
    const ready = [...this.entries.entries()]
      .filter((e): e is [string, Extract<CacheEntry, { state: 'ready' }>] => e[1].state === 'ready')
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let liveCount = ready.length + [...this.entries.values()].filter((e) => e.state === 'building').length;
    for (const [id, entry] of ready) {
      if (liveCount < this.maxLive) break;
      // Never dispose an active project — exceed the budget instead; a finished
      // turn re-triggers eviction via reapIdle().
      if (entry.ctx.hasInFlightTurn()) continue;
      this.entries.delete(id);
      liveCount--;
      console.log(`[context-cache] evicting idle project ${id} (maxLive=${this.maxLive})`);
      entry.ctx.dispose().catch((err) => {
        console.warn(`[context-cache] dispose of evicted ${id} failed:`, err);
      });
    }
  }

  /** Process shutdown: dispose everything (live + retired), ignoring in-flight guards. */
  async disposeAll(): Promise<void> {
    const ctxs: ProjectContext[] = [...this.retired];
    for (const entry of this.entries.values()) {
      if (entry.state === 'ready') ctxs.push(entry.ctx);
    }
    this.entries.clear();
    this.retired.clear();
    await Promise.allSettled(ctxs.map((c) => c.dispose()));
  }
}

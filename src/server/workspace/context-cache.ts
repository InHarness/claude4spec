import type { ContextInvalidation } from '../../shared/types.js';
import type { BackgroundBuildResult } from './bootstrap.js';
import type { ProjectContext } from './project-context.js';
import type { ProjectRecord } from './types.js';

/** M31 `m31ctx001`: how long a failed build holds its error state before the next attempt may start. */
export const FAILED_BUILD_WINDOW_MS = 15_000;

/**
 * 2.1.60 (M31 `m31ctx001`, `ssn335r8`): the five build states of a project —
 * in the queue, building, ready, failed (with its cause), needs activation.
 */
export type ProjectBuildState = 'queued' | 'building' | 'ready' | 'failed' | 'needs-activation';

/** The internal signal every state change emits. Exposing it outside belongs to its consumer. */
export interface ProjectBuildStateChange {
  projectId: string;
  state: ProjectBuildState;
  /** The cause of a failed build — set exactly when `state` is `failed`. */
  cause?: string;
}

export class ProjectBuildFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectBuildFailedError';
  }
}

interface Waiter {
  resolve: (ctx: ProjectContext) => void;
  reject: (err: Error) => void;
}

/** One project's build state — the entry of the cache and of the queue alike. */
interface Entry {
  project: ProjectRecord;
  state: ProjectBuildState;
  ctx?: ProjectContext;
  cause?: string;
  failedAt?: number;
  /** The next build of this entry is the activation with writes (a request met «needs activation»). */
  activate: boolean;
  /** Requests waiting for this entry's next outcome. */
  waiters: Waiter[];
  /** Settles when the build in progress ends (set while `building`). */
  settled?: Promise<void>;
  /** The entry was dropped by a purge while building: `retire` disposes its result. */
  purged?: boolean;
  /** The invalidation that dropped the entry while building — handed to the result's dispose. */
  invalidation?: ContextInvalidation;
}

export interface ProjectContextCacheOptions {
  /**
   * The background build (M01 `dsh8ezbz`): the activation's steps without
   * writes, then the context — «ready» or «needs activation»; a rejection is
   * the error state. Without it every build is `build` (a test composition).
   */
  background?: (project: ProjectRecord) => Promise<BackgroundBuildResult<ProjectContext>>;
  /** Clock of the failed-build window — injectable for tests. */
  now?: () => number;
}

/**
 * M31 `m31ctx001` (2.1.60): the cache of live contexts, the background build
 * queue and the build state of every project — one object, one process.
 *
 * - **Queue.** After `app.listen()` the server hands it the composition of the
 *   workspace ({@link start}): the last opened project first, then the
 *   composition order. Builds run ONE at a time, in their awaited part — the
 *   queue moves on when the current build resolves (its background projections
 *   may still run). Registration appends a project ({@link enqueue}).
 * - **Priority.** Two levels today: a project with a waiting request, then the
 *   rest. A request to a queued project moves it to the front; it builds right
 *   after the current build. (The level of invalidated projects sits between
 *   the two — `U4b`'s, not built here.)
 * - **Request.** {@link get} answers a ready context at once; a project being
 *   built or queued is waited for; «needs activation» runs the activation with
 *   writes (`build`) and then the context; a failed build within its window
 *   rejects with the cause; after the window the request starts the next try.
 * - **No limit.** The number of live contexts is not bounded — no eviction.
 * - **Failed build.** The error state holds at least {@link FAILED_BUILD_WINDOW_MS};
 *   the background never retries on its own (a permanently broken project would
 *   loop). A request or a read of the workspace's project states
 *   ({@link readStates}) after the window puts the project back in the queue.
 */
export class ProjectContextCache {
  private readonly entries = new Map<string, Entry>();
  /** Queue levels, front first: projects with a waiting request, then the rest. */
  private readonly requested: string[] = [];
  private readonly rest: string[] = [];
  private running = false;
  private closed = false;
  /** Retired contexts awaiting idle, each with the invalidation that retired it. */
  private readonly retired = new Map<ProjectContext, ContextInvalidation | undefined>();
  private readonly listeners = new Set<(change: ProjectBuildStateChange) => void>();
  private readonly background: (project: ProjectRecord) => Promise<BackgroundBuildResult<ProjectContext>>;
  private readonly now: () => number;

  constructor(
    private readonly build: (project: ProjectRecord) => Promise<ProjectContext>,
    opts: ProjectContextCacheOptions = {},
  ) {
    this.background =
      opts.background ?? (async (project) => ({ state: 'ready', context: await build(project) }));
    this.now = opts.now ?? (() => Date.now());
  }

  /** Subscribe to the state signal; returns the unsubscribe. */
  onStateChange(listener: (change: ProjectBuildStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * After listen: queue every project of the composition that has no state yet
   * — the last opened project first (when it still belongs to the workspace),
   * then the composition order.
   */
  start(projects: readonly ProjectRecord[], lastOpenedProject?: string): void {
    const first = projects.find((p) => p.id === lastOpenedProject);
    const ordered = first ? [first, ...projects.filter((p) => p !== first)] : [...projects];
    for (const project of ordered) this.enqueue(project);
  }

  /** Registration (and the start): the project joins the end of the queue — unless it already has a state. */
  enqueue(project: ProjectRecord): void {
    if (this.closed || this.entries.has(project.id)) return;
    const entry: Entry = { project, state: 'queued', activate: false, waiters: [] };
    this.entries.set(project.id, entry);
    this.rest.push(project.id);
    this.emit(entry);
    this.pump();
  }

  /** A request to the project: its ready context, or the end of its build (preceded by the activation when it needs one). */
  get(project: ProjectRecord): Promise<ProjectContext> {
    const id = project.id;
    let entry = this.entries.get(id);
    if (entry?.state === 'ready') return Promise.resolve(entry.ctx!);
    if (entry?.state === 'failed') {
      if (this.now() - entry.failedAt! < FAILED_BUILD_WINDOW_MS) {
        return Promise.reject(new ProjectBuildFailedError(entry.cause!));
      }
      this.setQueued(entry);
    } else if (entry?.state === 'needs-activation') {
      entry.activate = true;
      this.setQueued(entry);
    } else if (entry === undefined) {
      if (this.closed) return Promise.reject(new Error('the server is shutting down'));
      entry = { project, state: 'queued', activate: false, waiters: [] };
      this.entries.set(id, entry);
      this.emit(entry);
    }
    const waiting = entry;
    const outcome = new Promise<ProjectContext>((resolve, reject) => waiting.waiters.push({ resolve, reject }));
    if (waiting.state === 'queued') {
      waiting.project = project; // the request's record is the freshest
      this.promote(id);
    }
    this.pump();
    return outcome;
  }

  /**
   * A read of the workspace's project states (GET /api/workspace) — not a
   * request to any project: the queue order stays. A project whose failed
   * build is past its window goes back to the END of the queue.
   */
  readStates(): ReadonlyMap<string, ProjectBuildState> {
    for (const entry of this.entries.values()) {
      if (entry.state === 'failed' && this.now() - entry.failedAt! >= FAILED_BUILD_WINDOW_MS) {
        this.setQueued(entry);
        this.rest.push(entry.project.id);
      }
    }
    this.pump();
    return new Map([...this.entries].map(([id, entry]) => [id, entry.state]));
  }

  getLive(projectId: string): ProjectContext | null {
    const entry = this.entries.get(projectId);
    return entry?.state === 'ready' ? entry.ctx! : null;
  }

  /**
   * Drop the entry; a ready context is parked in `retired` and disposed once
   * idle. The next request builds again.
   *
   * A QUEUED entry is left as it is, queue position and waiters included: it
   * has no context to invalidate and its build reads the fresh state anyway —
   * dropping it would take the project out of the background build (an
   * `invalidateAll` during the startup sweep would empty the queue).
   *
   * 2.1.16 (M50 `8h2a734u`): `opts.reason` is handed to that context's
   * `dispose`, so its room hears WHY (`activation-changed` keeps the SPA page).
   */
  invalidate(projectId: string, opts?: ContextInvalidation): void {
    const entry = this.entries.get(projectId);
    if (!entry || entry.state === 'queued') return;
    this.entries.delete(projectId);
    // Only a building entry has waiters here (a ready one resolved them, a failed
    // one rejected them): they follow the project once the build settles.
    if (entry.state === 'ready') this.retired.set(entry.ctx!, opts);
    else if (entry.state === 'building') entry.invalidation = opts;
    this.reapIdle();
  }

  /**
   * Detach (the project left the workspace, its slot stays): a QUEUED entry is
   * dropped — its queue position goes stale and its waiting requests are
   * rejected with the removed-from-the-workspace error, as `retire` does — so
   * the background sweep never builds a project that is no longer in the
   * workspace. Any other state is invalidated.
   */
  remove(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (entry?.state !== 'queued') return this.invalidate(projectId);
    this.entries.delete(projectId);
    this.rejectWaiters(entry, new ProjectBuildFailedError(`project '${projectId}' was removed from the workspace`));
  }

  /**
   * M33 phase 3: invalidate every cached context — used when the process-global
   * base plugin pool changes (the base catalog is shared, so a base reload
   * invalidates ALL dependent contexts). Same fire-and-forget semantics as
   * `invalidate`; in-flight turns finish on their captured (old) context.
   */
  invalidateAll(): void {
    for (const id of [...this.entries.keys()]) this.invalidate(id);
  }

  /**
   * Purge path: drop the entry and AWAIT its dispose (unlike fire-and-forget
   * `invalidate`) so the db handle is closed before the caller `fs.rm`s the
   * slot dir. The caller guarantees no in-flight turn (409 otherwise).
   */
  async retire(projectId: string): Promise<void> {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    this.entries.delete(projectId);
    if (entry.state === 'ready') {
      await entry.ctx!.dispose();
    } else if (entry.state === 'building') {
      entry.purged = true;
      await entry.settled;
      await entry.ctx?.dispose();
    } else {
      this.rejectWaiters(entry, new ProjectBuildFailedError(`project '${projectId}' was removed from the workspace`));
    }
  }

  /**
   * Dispose retired contexts whose agent turns have all finished. Called on
   * invalidate and from every turn's `finally` (onTurnFinished).
   */
  reapIdle(): void {
    for (const [ctx, opts] of this.retired) {
      if (!ctx.hasInFlightTurn()) {
        this.retired.delete(ctx);
        ctx.dispose(opts).catch((err) => {
          console.warn(`[context-cache] dispose of retired ${ctx.projectId} failed:`, err);
        });
      }
    }
  }

  /** Process shutdown: the queue stops; dispose everything (live + retired), ignoring in-flight guards. */
  async disposeAll(): Promise<void> {
    this.closed = true;
    this.requested.length = 0;
    this.rest.length = 0;
    const ctxs: ProjectContext[] = [...this.retired.keys()];
    for (const entry of this.entries.values()) {
      if (entry.state === 'ready') ctxs.push(entry.ctx!);
      else if (entry.state !== 'building') this.rejectWaiters(entry, new Error('the server is shutting down'));
    }
    this.entries.clear();
    this.retired.clear();
    await Promise.allSettled(ctxs.map((c) => c.dispose()));
  }

  // ─── the queue ────────────────────────────────────────────────────────────

  private setQueued(entry: Entry): void {
    entry.cause = undefined;
    entry.failedAt = undefined;
    entry.state = 'queued';
    this.emit(entry);
  }

  /** Move a queued project to the request level (it builds right after the current build). */
  private promote(id: string): void {
    if (this.requested.includes(id)) return;
    const at = this.rest.indexOf(id);
    if (at >= 0) this.rest.splice(at, 1);
    this.requested.push(id);
  }

  private next(): Entry | undefined {
    for (;;) {
      const id = this.requested.shift() ?? this.rest.shift();
      if (id === undefined) return undefined;
      const entry = this.entries.get(id);
      // A stale position: the project was dropped, or is already past the queue.
      if (entry?.state === 'queued') return entry;
    }
  }

  private pump(): void {
    if (this.running || this.closed) return;
    this.running = true;
    void (async () => {
      try {
        for (let entry = this.next(); entry && !this.closed; entry = this.next()) {
          await this.runBuild(entry);
        }
      } finally {
        this.running = false;
      }
    })();
  }

  /** One build of the queue — never rejects: its outcome is the entry's state. */
  private async runBuild(entry: Entry): Promise<void> {
    let settle!: () => void;
    entry.settled = new Promise<void>((resolve) => (settle = resolve));
    entry.state = 'building';
    this.emit(entry);
    const { project } = entry;
    try {
      let ctx: ProjectContext | undefined;
      if (entry.activate) {
        ctx = await this.build(project);
      } else {
        const result = await this.background(project);
        if (result.state === 'ready') ctx = result.context;
        // «Needs activation» with a request already waiting: that request is
        // the first one, so the activation and the build follow right here.
        else if (entry.waiters.length > 0 && this.isCurrent(entry)) ctx = await this.build(project);
      }
      entry.activate = false;
      if (!this.isCurrent(entry)) return this.settleDropped(entry, ctx);
      if (ctx === undefined) {
        entry.state = 'needs-activation';
        this.emit(entry);
        return;
      }
      entry.ctx = ctx;
      entry.state = 'ready';
      this.emit(entry);
      for (const w of entry.waiters.splice(0)) w.resolve(ctx);
    } catch (err) {
      entry.activate = false;
      if (!this.isCurrent(entry)) return this.settleDropped(entry, undefined);
      entry.cause = err instanceof Error ? err.message : String(err);
      entry.failedAt = this.now();
      entry.state = 'failed';
      this.emit(entry);
      this.rejectWaiters(entry, new ProjectBuildFailedError(entry.cause));
    } finally {
      settle();
    }
  }

  private isCurrent(entry: Entry): boolean {
    return !this.closed && this.entries.get(entry.project.id) === entry;
  }

  /**
   * A build whose entry was dropped while it ran (an invalidation, a purge, the
   * shutdown): its context is not served. A purge disposes it itself
   * (`retire`); otherwise it is parked in `retired` like any invalidated
   * context. Waiting requests follow an invalidated project to its next build.
   */
  private settleDropped(entry: Entry, ctx: ProjectContext | undefined): void {
    if (ctx && entry.purged) entry.ctx = ctx;
    else if (ctx && this.closed) void ctx.dispose().catch(() => {});
    else if (ctx) {
      this.retired.set(ctx, entry.invalidation);
      this.reapIdle();
    }
    if (this.closed) this.rejectWaiters(entry, new Error('the server is shutting down'));
    else if (entry.purged) {
      this.rejectWaiters(entry, new ProjectBuildFailedError(`project '${entry.project.id}' was removed from the workspace`));
    } else this.redispatch(entry);
  }

  /** Hand the waiting requests of an invalidated entry to the project's next build. */
  private redispatch(entry: Entry): void {
    for (const w of entry.waiters.splice(0)) this.get(entry.project).then(w.resolve, w.reject);
  }

  private rejectWaiters(entry: Entry, err: Error): void {
    for (const w of entry.waiters.splice(0)) w.reject(err);
  }

  private emit(entry: Entry): void {
    const change: ProjectBuildStateChange = { projectId: entry.project.id, state: entry.state };
    if (entry.state === 'failed') change.cause = entry.cause;
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (err) {
        console.warn('[context-cache] a build state listener failed:', err);
      }
    }
  }
}

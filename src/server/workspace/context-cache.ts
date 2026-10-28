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
  /** The ready context — or the result of a build dropped by a purge or the shutdown, which disposes it. */
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

/** A build of the queue; `signal` aborts at the process shutdown (the build releases what it holds and rejects). */
export type ContextBuild = (project: ProjectRecord, signal: AbortSignal) => Promise<ProjectContext>;

export interface ProjectContextCacheOptions {
  /**
   * The background build (M01 `dsh8ezbz`): the activation's steps without
   * writes, then the context — «ready» or «needs activation»; a rejection is
   * the error state. Without it every build is `build` (a test composition).
   */
  background?: (project: ProjectRecord, signal: AbortSignal) => Promise<BackgroundBuildResult<ProjectContext>>;
  /** Clock of the failed-build window — injectable for tests. */
  now?: () => number;
}

const removedFromWorkspace = (projectId: string) =>
  new ProjectBuildFailedError(`project '${projectId}' was removed from the workspace`);
const shuttingDown = () => new Error('the server is shutting down');

/**
 * M31 `m31ctx001` (2.1.60): the cache of live contexts, the background build
 * queue and the build state of every project — one object, one process.
 *
 * - **Queue.** After `app.listen()` the server hands it the composition of the
 *   workspace ({@link start}): the last opened project first, then the
 *   composition order. Builds run ONE at a time, in their awaited part — the
 *   queue moves on when the current build resolves (its background projections
 *   may still run). Registration appends a project ({@link enqueue}).
 * - **Priority.** Three levels: a project with a waiting request, an
 *   invalidated project, the rest. A request to a queued project moves it to
 *   the front; it builds right after the current build. Invalidated projects
 *   keep the composition order among themselves.
 * - **Request.** {@link get} answers a ready context at once; a project being
 *   built or queued is waited for; «needs activation» runs the activation with
 *   writes (`build`) and then the context; a failed build within its window
 *   rejects with the cause; after the window the request starts the next try.
 * - **Invalidation** ({@link invalidate}) puts the project in the queue at
 *   once, on the invalidated level — the rebuild does not wait for a request.
 *   It clears a failed build's window; during the project's build it sends that
 *   build's result to `retired` and queues the next build (which reads the
 *   current registry).
 * - **Release.** A context is disposed at three moments only: the project's
 *   detach or purge ({@link remove}, {@link retire}), its invalidation (the
 *   predecessor, once its turns end — {@link reapIdle}) and the process
 *   shutdown ({@link disposeAll}), which aborts the build in progress.
 * - **No limit.** The number of live contexts is not bounded — no eviction.
 * - **Failed build.** The error state holds at least {@link FAILED_BUILD_WINDOW_MS};
 *   the background never retries on its own (a permanently broken project would
 *   loop). A request or a read of the workspace's project states
 *   ({@link readStates}) after the window puts the project back in the queue.
 */
export class ProjectContextCache {
  private readonly entries = new Map<string, Entry>();
  /** The workspace's composition order — the order of invalidated projects in the queue. */
  private composition: string[] = [];
  /** Queue levels, front first: projects with a waiting request, invalidated projects, the rest. */
  private readonly requested: string[] = [];
  private readonly invalidated: string[] = [];
  private readonly rest: string[] = [];
  private running = false;
  private closed = false;
  /** The build in progress (one at a time) and the abort of its signal. */
  private current?: { entry: Entry; abort: AbortController };
  /** Retired contexts awaiting idle, each with the invalidation that retired it. */
  private readonly retired = new Map<ProjectContext, ContextInvalidation | undefined>();
  private readonly listeners = new Set<(change: ProjectBuildStateChange) => void>();
  private readonly background: (project: ProjectRecord, signal: AbortSignal) => Promise<BackgroundBuildResult<ProjectContext>>;
  private readonly now: () => number;

  constructor(
    private readonly build: ContextBuild,
    opts: ProjectContextCacheOptions = {},
  ) {
    this.background =
      opts.background ?? (async (project, signal) => ({ state: 'ready', context: await build(project, signal) }));
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
    for (const p of projects) this.join(p.id);
    const first = projects.find((p) => p.id === lastOpenedProject);
    const ordered = first ? [first, ...projects.filter((p) => p !== first)] : [...projects];
    for (const project of ordered) this.enqueue(project);
  }

  /** Registration (and the start): the project joins the end of the queue — unless it already has a state. */
  enqueue(project: ProjectRecord): void {
    if (this.closed || this.entries.has(project.id)) return;
    this.join(project.id);
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
      if (this.closed) return Promise.reject(shuttingDown());
      this.join(id);
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
   * M31 `m31ctx001` (2.1.60): the invalidation puts the project in the queue at
   * once, on the invalidated level — the rebuild does not wait for a request:
   *
   * - a READY context is parked in `retired` (disposed once its turns end) and
   *   the project is queued;
   * - a FAILED build (or «needs activation») loses its window and is queued;
   * - a QUEUED project stays an entry, its waiters included, and is raised to
   *   the invalidated level (a request-level position is kept);
   * - during the project's BUILD the result of that build goes to `retired` and
   *   a successor entry — holding the waiting requests — is queued: the next
   *   build reads the current registry.
   *
   * 2.1.16 (M50 `8h2a734u`): `opts.reason` is handed to the retired context's
   * `dispose`, so its room hears WHY (`activation-changed` keeps the SPA page).
   */
  invalidate(projectId: string, opts?: ContextInvalidation): void {
    const entry = this.entries.get(projectId);
    if (!entry || this.closed) return;
    this.invalidateEntry(entry, opts);
    this.reapIdle();
    this.pump();
  }

  /**
   * M33 phase 3: invalidate every cached context — used when the process-global
   * base plugin pool changes (the base catalog is shared, so a base reload
   * invalidates ALL dependent contexts). The projects line up in the
   * composition order, behind the projects with a waiting request.
   */
  invalidateAll(): void {
    if (this.closed) return;
    for (const entry of [...this.entries.values()]) this.invalidateEntry(entry, undefined);
    this.reapIdle();
    this.pump();
  }

  /**
   * Detach (M31 `7fgfpqzf`: the project left the workspace, its slot stays):
   * the project leaves the cache and the queue, and its waiting requests are
   * rejected with the removed-from-the-workspace error — never handed to a
   * next build. A ready context is released (parked in `retired`, disposed
   * at once unless a turn is in flight); a build in progress ends, and its
   * result is released right after it.
   */
  remove(projectId: string): void {
    this.composition = this.composition.filter((id) => id !== projectId);
    const entry = this.entries.get(projectId);
    if (!entry) return;
    this.entries.delete(projectId);
    this.rejectWaiters(entry, removedFromWorkspace(projectId));
    if (entry.state === 'ready') {
      this.retired.set(entry.ctx!, undefined);
      this.reapIdle();
    }
    // A `building` entry is no longer current: its result goes to `retired`
    // when the build ends (settleDropped) and is disposed there.
  }

  /**
   * Purge path: like the detach, but AWAITS the release so the db handle is
   * closed before the caller `fs.rm`s the slot dir. A build in progress — the
   * project's current entry, or an earlier one an invalidation left running —
   * ends first and its result is disposed then: the slot is deleted only after
   * that. The caller guarantees no in-flight turn (409 otherwise).
   */
  async retire(projectId: string): Promise<void> {
    this.composition = this.composition.filter((id) => id !== projectId);
    const entry = this.entries.get(projectId);
    const disposals: Promise<void>[] = [];
    const builds: Entry[] = [];
    if (entry) {
      this.entries.delete(projectId);
      this.rejectWaiters(entry, removedFromWorkspace(projectId));
      if (entry.state === 'ready') disposals.push(entry.ctx!.dispose());
      else if (entry.state === 'building') builds.push(entry);
    }
    const running = this.current?.entry;
    if (running && running !== entry && running.project.id === projectId) builds.push(running);
    for (const build of builds) build.purged = true;
    for (const build of builds) {
      await build.settled;
      if (build.ctx) disposals.push(build.ctx.dispose());
    }
    await Promise.all(disposals);
  }

  /**
   * Dispose retired contexts whose agent turns have all finished. Called on
   * invalidate, on detach and from every turn's `finally` (onTurnFinished).
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

  /**
   * Process shutdown: the queue stops, every waiting request is rejected, the
   * build in progress is aborted (it releases its partial resources in reverse
   * acquisition order and rejects — or, done already, its context is disposed
   * here), and every context — live and retired — is disposed, ignoring
   * in-flight guards.
   */
  async disposeAll(): Promise<void> {
    this.closed = true;
    this.requested.length = 0;
    this.invalidated.length = 0;
    this.rest.length = 0;
    this.composition = [];
    const disposals: Promise<void>[] = [...this.retired.keys()].map((c) => c.dispose());
    for (const entry of this.entries.values()) {
      this.rejectWaiters(entry, shuttingDown());
      if (entry.state === 'ready') disposals.push(entry.ctx!.dispose());
    }
    this.entries.clear();
    this.retired.clear();
    const running = this.current;
    if (running) {
      running.abort.abort(shuttingDown());
      await running.entry.settled;
      // A purge awaiting the same build disposes its result itself.
      if (running.entry.ctx && !running.entry.purged) disposals.push(running.entry.ctx.dispose());
    }
    await Promise.allSettled(disposals);
  }

  // ─── the queue ────────────────────────────────────────────────────────────

  /** The project belongs to the composition (appended when new). */
  private join(id: string): void {
    if (!this.composition.includes(id)) this.composition.push(id);
  }

  private invalidateEntry(entry: Entry, opts: ContextInvalidation | undefined): void {
    const id = entry.project.id;
    if (entry.state === 'building') {
      // The build's result is not served: it goes to `retired` (settleDropped).
      entry.invalidation = opts;
      const successor: Entry = { project: entry.project, state: 'queued', activate: false, waiters: entry.waiters.splice(0) };
      this.entries.set(id, successor);
      this.emit(successor);
      if (successor.waiters.length > 0) return this.promote(id);
    } else if (entry.state === 'ready') {
      this.retired.set(entry.ctx!, opts);
      entry.ctx = undefined;
      this.setQueued(entry);
    } else if (entry.state !== 'queued') {
      this.setQueued(entry); // a failed build loses its window
    }
    this.raise(id);
  }

  private setQueued(entry: Entry): void {
    entry.cause = undefined;
    entry.failedAt = undefined;
    entry.state = 'queued';
    this.emit(entry);
  }

  /** Move a queued project to the request level (it builds right after the current build). */
  private promote(id: string): void {
    if (this.requested.includes(id)) return;
    remove(this.invalidated, id);
    remove(this.rest, id);
    this.requested.push(id);
  }

  /** Move a queued project to the invalidated level, in the composition order; a request-level position stays. */
  private raise(id: string): void {
    if (this.requested.includes(id) || this.invalidated.includes(id)) return;
    remove(this.rest, id);
    const rank = (x: string) => {
      const at = this.composition.indexOf(x);
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    const before = this.invalidated.findIndex((other) => rank(other) > rank(id));
    if (before < 0) this.invalidated.push(id);
    else this.invalidated.splice(before, 0, id);
  }

  private next(): Entry | undefined {
    for (;;) {
      const id = this.requested.shift() ?? this.invalidated.shift() ?? this.rest.shift();
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
    const abort = new AbortController();
    this.current = { entry, abort };
    entry.state = 'building';
    this.emit(entry);
    const { project } = entry;
    try {
      let ctx: ProjectContext | undefined;
      if (entry.activate) {
        ctx = await this.build(project, abort.signal);
      } else {
        const result = await this.background(project, abort.signal);
        if (result.state === 'ready') ctx = result.context;
        // «Needs activation» with a request already waiting: that request is
        // the first one, so the activation and the build follow right here.
        else if (entry.waiters.length > 0 && this.isCurrent(entry)) ctx = await this.build(project, abort.signal);
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
      if (this.current?.entry === entry) this.current = undefined;
      settle();
    }
  }

  private isCurrent(entry: Entry): boolean {
    return !this.closed && this.entries.get(entry.project.id) === entry;
  }

  /**
   * A build whose entry left the cache while it ran — its context is never
   * served, and it has no waiters left (an invalidation handed them to the
   * successor; a detach, a purge or the shutdown rejected them). A purge or
   * the shutdown disposes the result itself (`retire`, `disposeAll`); an
   * invalidation or a detach parks it in `retired`, disposed at once when idle.
   */
  private settleDropped(entry: Entry, ctx: ProjectContext | undefined): void {
    if (!ctx) return;
    if (entry.purged || this.closed) {
      entry.ctx = ctx;
      return;
    }
    this.retired.set(ctx, entry.invalidation);
    this.reapIdle();
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

function remove(list: string[], id: string): void {
  const at = list.indexOf(id);
  if (at >= 0) list.splice(at, 1);
}

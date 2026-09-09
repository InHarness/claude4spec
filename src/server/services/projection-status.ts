import { indexStale } from '../discovery/errors.js';
import type {
  ProjectionScope,
  ProjectionState,
  ProjectionStatusRow,
} from '../../shared/projection-status.js';
import type { WsEmitter } from '../ws/project-emitter.js';

/**
 * 0.2.77 — where "this projection no longer describes the files" is KEPT.
 *
 * Until now the fact existed only as a moment: M40 retried a failed `projection`
 * phase, gave up, broadcast `projection:stale` and returned the subscription id
 * in `ChainResult.staleProjections`. Nothing stored it and nothing read it, so
 * the projection went on answering from pre-failure state — and an operation
 * that took coordinates from that answer and wrote against them landed in the
 * wrong place, silently. `src/shared/types.ts` said as much when it declared the
 * event: enforcement "is not closed in this release".
 *
 * This registry closes it. It is deliberately NOT a projection itself and owns no
 * index: it holds one small record per projection and the entry point to that
 * projection's own full recompute. Marking is done BY THE OWNER — M40 reports
 * which reaction failed on which artifact and stops there, because it does not
 * know how many artifacts somebody else's projection divides into, or whether a
 * single bad artifact poisons the rest.
 *
 * ## Who refuses
 *
 * `refusesReads` is a property of the PROJECTION, not of a caller or a request.
 * The rule that decides it: does a read off this projection hand out coordinates
 * or identities that the caller then WRITES against? M06 (line ranges), M29
 * (entity rows behind a write) and M14 (the backref list rename-sync rewrites)
 * all do, so they refuse. M02's frontmatter index and M08's todo index do not —
 * their records carry a key the writer itself supplied, and jump targets. The
 * cost of their staleness is a wrong count or a wrong scroll position: a VIEW,
 * never content. They still carry the flag, so the card can report them.
 */

/** How a marking's artifact keys are formed, per projection. */
export const PROJECTION_IDS = {
  sections: 'm06-sections',
  pageLinks: 'm14-page-links',
  entities: 'm29-entities',
  releases: 'm29-releases',
  frontmatter: 'm02-frontmatter',
  todos: 'm08-todos',
} as const;

export type ProjectionId = (typeof PROJECTION_IDS)[keyof typeof PROJECTION_IDS];

interface ProjectionDef {
  readonly id: ProjectionId;
  readonly label: string;
  readonly refusesReads: boolean;
  /**
   * `true` for M14 alone: a marking on ANY source page refuses EVERY backref
   * read, whichever target is asked about. `reverseIndex` aggregates over all
   * sources, so one unrecomputed source page corrupts the answer for every
   * target — the refusal sits on the projection, not on the question.
   */
  readonly localMarkPoisonsAll: boolean;
}

const DEFS: readonly ProjectionDef[] = [
  { id: PROJECTION_IDS.sections, label: 'Section index & entity junctions', refusesReads: true, localMarkPoisonsAll: false },
  { id: PROJECTION_IDS.pageLinks, label: 'Page link map', refusesReads: true, localMarkPoisonsAll: true },
  { id: PROJECTION_IDS.entities, label: 'Entity tables & tag registry', refusesReads: true, localMarkPoisonsAll: false },
  { id: PROJECTION_IDS.releases, label: 'Release metadata cache', refusesReads: true, localMarkPoisonsAll: true },
  { id: PROJECTION_IDS.frontmatter, label: 'Frontmatter index', refusesReads: false, localMarkPoisonsAll: false },
  { id: PROJECTION_IDS.todos, label: 'TODO index', refusesReads: false, localMarkPoisonsAll: false },
];

interface Entry {
  state: ProjectionState;
  /**
   * Marked artifacts, each with the sequence number of the marking that recorded
   * it; empty with `state==='stale'` means a GLOBAL marking. The sequence is what
   * lets a finishing rebuild clear the markings it set out to fix WITHOUT erasing
   * one that arrived while it was running — see `finishRebuild`.
   */
  artifacts: Map<string, number>;
  /** Sequence of the current global marking; `0` when there is none. */
  globalSeq: number;
  lastRebuiltAt: number | null;
  rebuild?: () => Promise<void>;
  /** A pass already running — a second request joins it instead of starting one. */
  inFlight?: Promise<void>;
}

/**
 * Opaque handle from `beginRebuild()`. Hand it back to `finishRebuild()` and the
 * registry clears exactly the markings that predate the pass.
 */
export type RebuildToken = number;

export class ProjectionStatusRegistry {
  private readonly entries = new Map<ProjectionId, Entry>();

  /** Monotonic; every marking is stamped with it. Never reset. */
  private seq = 0;

  constructor(private readonly ws?: WsEmitter) {
    for (const def of DEFS) {
      // `not_materialized` is the honest starting state: at construction time no
      // `indexAll()` has run yet. Boot flips each one to `fresh` as it succeeds.
      this.entries.set(def.id, {
        state: 'not_materialized',
        artifacts: new Map(),
        globalSeq: 0,
        lastRebuiltAt: null,
      });
    }
  }

  /** Wire a projection's own full recompute. Called once, at context build. */
  registerRebuild(id: ProjectionId, rebuild: () => Promise<void>): void {
    const e = this.entries.get(id);
    if (e) e.rebuild = rebuild;
  }

  /**
   * Mark stale. No artifact ⇒ GLOBAL — which is also what a failed FULL rebuild
   * reports, since it has no single artifact to blame.
   *
   * A global marking SUPERSEDES any accumulated local ones rather than joining
   * them: once the whole projection is unusable, listing which pages were noticed
   * first would suggest the others are fine.
   */
  markStale(id: ProjectionId, artifact?: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    const wasState = e.state;
    const wasScope = this.scopeOf(e);
    const seq = ++this.seq;
    if (artifact === undefined) {
      e.artifacts.clear();
      e.globalSeq = seq;
    } else {
      // An already-global marking does not narrow to a local one.
      if (!(e.state === 'stale' && e.artifacts.size === 0)) e.artifacts.set(artifact, seq);
    }
    e.state = 'stale';
    if (wasState !== e.state || !sameScope(wasScope, this.scopeOf(e))) this.emit(id, e);
  }

  /**
   * Clear a marking. With an artifact it clears just that one — and the
   * projection only returns to `fresh` when the last marked artifact is gone.
   *
   * `lastRebuiltAt` moves ONLY from here, and only on a genuinely successful
   * recompute. That is what makes the card's second edge case answerable: a
   * projection that goes stale again immediately after a successful rebuild is a
   * SECOND, separate failure — not a failed action — and the moved timestamp is
   * how the two are told apart.
   */
  markFresh(id: ProjectionId, artifact?: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    const wasState = e.state;
    const wasScope = this.scopeOf(e);
    if (artifact !== undefined) {
      // One artifact recomputed. It can clear its OWN marking and nothing else:
      // a global marking says the whole projection is unusable, and a single
      // page succeeding is no evidence against that — clearing it here would
      // report health nobody established. Same for a projection already fresh:
      // there is nothing to clear, and `lastRebuiltAt` must not move, because a
      // per-artifact success is not the full recompute that field reports.
      if (e.state !== 'stale' || e.artifacts.size === 0) return;
      if (!e.artifacts.delete(artifact)) return;
      if (e.artifacts.size > 0) {
        if (!sameScope(wasScope, this.scopeOf(e))) this.emit(id, e);
        return;
      }
      e.state = 'fresh';
      this.emit(id, e);
      return;
    }
    e.artifacts.clear();
    e.globalSeq = 0;
    e.state = 'fresh';
    e.lastRebuiltAt = Date.now();
    if (wasState !== e.state || !sameScope(wasScope, this.scopeOf(e))) this.emit(id, e);
  }

  /**
   * Open a rebuild pass. Take the token BEFORE the recompute starts.
   *
   * The pair `beginRebuild`/`finishRebuild` exists because a full recompute is
   * not instantaneous and the world does not hold still for it. Two things can
   * mark a projection while its own rebuild is running: a watcher reaction that
   * fails on some page, and the rebuild ITSELF — `EntityIndexerService.indexAll`
   * marks every declared type whose table no migration created, from inside the
   * pass. A blanket `markFresh()` at the end would erase both, and the second one
   * is the worse loss: the pass would report health it had just disproved.
   */
  beginRebuild(): RebuildToken {
    return this.seq;
  }

  /**
   * Close a rebuild pass: clear the markings it was answering for, keep the ones
   * that arrived while it ran. `lastRebuiltAt` moves only when that leaves the
   * projection genuinely clean.
   */
  finishRebuild(id: ProjectionId, token: RebuildToken): void {
    const e = this.entries.get(id);
    if (!e) return;
    const wasState = e.state;
    const wasScope = this.scopeOf(e);
    if (e.state === 'stale') {
      if (e.artifacts.size === 0) {
        if (e.globalSeq <= token) {
          e.globalSeq = 0;
          e.state = 'fresh';
        }
      } else {
        for (const [artifact, seq] of [...e.artifacts]) {
          if (seq <= token) e.artifacts.delete(artifact);
        }
        if (e.artifacts.size === 0) e.state = 'fresh';
      }
    } else {
      e.state = 'fresh';
    }
    if (e.state === 'fresh') e.lastRebuiltAt = Date.now();
    if (wasState !== e.state || !sameScope(wasScope, this.scopeOf(e))) this.emit(id, e);
  }

  /**
   * Is this read refused?
   *
   * `artifact === undefined` asks the project-wide question ("is anything marked
   * at all"), which is what a cross-page operation such as `search_pages` needs:
   * it aggregates over pages, so one page it cannot place correctly is enough to
   * make the ranking wrong.
   */
  isStale(id: ProjectionId, artifact?: string): boolean {
    const e = this.entries.get(id);
    if (!e || e.state !== 'stale') return false;
    if (e.artifacts.size === 0) return true; // global
    if (artifact === undefined) return true;
    const def = DEFS.find((d) => d.id === id);
    if (def?.localMarkPoisonsAll) return true;
    return e.artifacts.has(artifact);
  }

  /**
   * Is the WHOLE projection marked, as opposed to some of its artifacts?
   *
   * The distinction matters wherever a caller must be refused BEFORE the
   * projection is consulted at all. A global marking usually means the index is
   * empty or half-built, so a lookup into it does not fail loudly — it comes back
   * empty, and the caller gets "not found" for something that exists. Asking this
   * first buys the right error without giving up per-artifact precision.
   */
  isGloballyStale(id: ProjectionId): boolean {
    const e = this.entries.get(id);
    return !!e && e.state === 'stale' && e.artifacts.size === 0;
  }

  /** `isGloballyStale` as a gate. */
  assertNotGloballyStale(id: ProjectionId): void {
    if (this.isGloballyStale(id)) throw indexStale(id, 'global');
  }

  /**
   * The fail-closed gate itself. Throws `INDEX_STALE`; returns nothing otherwise.
   *
   * Callers pass the artifact they are about to answer FOR, so a marking on one
   * page does not refuse the rest of the root.
   */
  assertFresh(id: ProjectionId, artifact?: string): void {
    if (!this.isStale(id, artifact)) return;
    const e = this.entries.get(id)!;
    throw indexStale(id, this.scopeOf(e) ?? 'global');
  }

  /** One row per projection — the diagnostic route's whole answer. */
  snapshot(): ProjectionStatusRow[] {
    return DEFS.map((def) => {
      const e = this.entries.get(def.id)!;
      const scope = this.scopeOf(e);
      return {
        id: def.id,
        label: def.label,
        state: e.state,
        ...(scope !== undefined ? { scope } : {}),
        lastRebuiltAt: e.lastRebuiltAt,
        refusesReads: def.refusesReads,
      };
    });
  }

  /** Every projection that is currently marked — the UI's "is anything wrong" question. */
  hasStale(): boolean {
    return [...this.entries.values()].some((e) => e.state === 'stale');
  }

  /**
   * Run a projection's full recompute and, on success, clear its marking.
   *
   * IDEMPOTENT and explicitly allowed on a `fresh` projection: the point of a
   * named rebuild button is that a user who suspects something may press it, and
   * a button that refuses when everything looks fine is a button that cannot be
   * used to check.
   *
   * A request arriving while a pass is already running JOINS it — it does not
   * start a second one, and it answers with the running pass's result. Two
   * concurrent full rebuilds of the same projection would race each other's
   * writes for no benefit.
   */
  async rebuild(id: ProjectionId): Promise<void> {
    const e = this.entries.get(id);
    if (!e) throw new Error(`unknown projection '${id}'`);
    if (e.inFlight) return await e.inFlight;
    if (!e.rebuild) throw new Error(`projection '${id}' has no rebuild registered`);
    const token = this.beginRebuild();
    const run = e
      .rebuild()
      .then(() => {
        this.finishRebuild(id, token);
      })
      .finally(() => {
        if (e.inFlight === run) e.inFlight = undefined;
      });
    e.inFlight = run;
    return await run;
  }

  /** Rebuild everything. Failures are collected, not swallowed — and not fatal to the rest. */
  async rebuildAll(): Promise<{ id: ProjectionId; error?: string }[]> {
    const out: { id: ProjectionId; error?: string }[] = [];
    for (const def of DEFS) {
      if (!this.entries.get(def.id)?.rebuild) continue;
      try {
        await this.rebuild(def.id);
        out.push({ id: def.id });
      } catch (err) {
        out.push({ id: def.id, error: (err as Error).message });
      }
    }
    return out;
  }

  ids(): ProjectionId[] {
    return DEFS.map((d) => d.id);
  }

  private scopeOf(e: Entry): ProjectionScope | undefined {
    if (e.state !== 'stale') return undefined;
    return e.artifacts.size === 0 ? 'global' : [...e.artifacts.keys()].sort();
  }

  /**
   * Announced in BOTH directions — the return to `fresh` matters as much as the
   * marking. A client that only ever hears about failure has no way to take the
   * banner down, and would need to poll to find out; nothing here polls.
   */
  private emit(id: ProjectionId, e: Entry): void {
    const scope = this.scopeOf(e);
    this.ws?.broadcast({
      kind: 'index:status-changed',
      projection: id,
      state: e.state,
      ...(scope !== undefined ? { scope } : {}),
    });
  }
}

function sameScope(a: ProjectionScope | undefined, b: ProjectionScope | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a === 'global' || b === 'global') return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

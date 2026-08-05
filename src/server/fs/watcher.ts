import chokidar, { type FSWatcher } from 'chokidar';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WsEvent } from '../../shared/types.js';
import { makeWatchIgnore } from './watch-ignore.js';

/**
 * M40 — File Watch Runtime (0.2.10).
 *
 * The ONLY place in the system that constructs directory observation. Before
 * 0.2.10 five modules each built their own `FSWatcher`, each kept its own
 * debounce, each recognized its own writes, and reaction order was an accident
 * of registration order inside `buildProjectContext`.
 *
 * Now: directory owners `mountSource(...)`, reacting modules `subscribe(...)`
 * with a declared phase and `after: [...]`, and this runtime enforces order,
 * self-write handling and dispatch.
 *
 * The runtime is purely mechanical — it does not know what any source MEANS,
 * does not parse content, does not evaluate gates and holds no projections.
 * `source` is an OPAQUE string, unique within a `scope`; the mount owner encodes
 * whatever discriminator it needs in the name (`pages:<rootId>`, `artifacts:brief`)
 * and subscribers derive their projection keys from the suffix.
 *
 * The public contract is defined WITHOUT reference to the filesystem — chokidar,
 * `awaitWriteFinish` and the debounce are implementation details of a mount.
 * Swapping the backend replaces the event provider inside mounts only;
 * subscribers, phases and broadcast stay untouched. We do NOT design a provider
 * system up front.
 */

/** `'process'` — the mount outlives `ProjectContext` rebuilds. `'context:<id>'` — it belongs to one context. */
export type WatchScope = 'process' | `context:${string}`;

/**
 * Closed taxonomy of reaction kinds, mechanically enforced.
 *
 * Spec vocabulary is Polish; these are the canonical API identifiers, mapped 1:1
 * (`projekcja` = `projection`, `powiadomienie` = `notification`; the other three
 * are already English in the spec).
 */
export type WatchPhase = 'projection' | 'notification' | 'reload' | 'write-back' | 'capture';

export type WatchOrigin = 'external' | 'server';
export type WatchEventKind = 'add' | 'change' | 'unlink';

/** Who performed a server write. Feeds M17's `changed_by` alongside `origin`. */
export type WatchActor = 'user' | 'agent';

/**
 * Execution order. NOTE this is deliberately NOT the order the taxonomy is
 * listed in: `projection | notification | reload` are mutually independent and
 * run first, then `write-back`, then `capture`.
 *
 * Why `capture` runs after `write-back`: the anchor-injection write is
 * suppressed, so it will not trigger a second capture. A snapshot taken BEFORE
 * injection would be the only version in the log and would freeze content that
 * never existed on disk as a final state — its `content_hash` would diverge from
 * the file, and restoring that version would strip the anchors.
 */
const PHASE_RANK: Record<WatchPhase, number> = {
  projection: 0,
  notification: 0,
  reload: 0,
  'write-back': 1,
  capture: 2,
};

/** Rank-0 phases run in this order; ranks then run 0 → 1 → 2. */
const PHASE_ORDER: WatchPhase[] = ['projection', 'notification', 'reload', 'write-back', 'capture'];

const PHASE_NAMES = new Set<string>(PHASE_ORDER);

/**
 * The handler contract — exactly these two methods, "nothing more". Store mode,
 * query API and parser belong to the subscriber, not to the mechanism.
 *
 * The event carries NO file content. A subscriber reads the file in its own
 * phase — and because write-back phases finish before `capture`, every later
 * subscriber sees the SETTLED state, not a snapshot from before someone else's write.
 */
export interface WatchSubscriber {
  onChange(scope: WatchScope, source: string, relPath: string, origin: WatchOrigin): void | Promise<void>;
  onUnlink(scope: WatchScope, source: string, relPath: string, origin: WatchOrigin): void | Promise<void>;
}

export interface SubscribeOptions {
  /** Stable id, PER SUBSCRIPTION not per module (M06 registers both `m06-section-indexer` and `m06-anchor-injection`). */
  id: string;
  phase: WatchPhase;
  /** Either a phase name (whole-phase dependency) or a sibling subscription id. */
  after?: string[];
  /**
   * Mechanical path filter — a glob on `relPath`. This is mechanics, not domain
   * knowledge; there are no wildcards on `source`.
   */
  filter?: string;
}

interface Subscription {
  id: string;
  phase: WatchPhase;
  after: string[];
  filter?: RegExp;
  handler: WatchSubscriber;
}

interface Mount {
  source: string;
  scope: WatchScope;
  dir: string;
  fsw: FSWatcher | null;
  /** Debounce timers, per file within this mount. */
  timers: Map<string, NodeJS.Timeout>;
  /** Resolved-at-arrival event awaiting its debounce window. */
  pending: Map<string, { event: WatchEventKind; origin: WatchOrigin }>;
  /** Tail of the dispatch chain, so `flush()` can await work already in flight. */
  inflight: Map<string, Promise<void>>;
  /** Set on unmount: a dispatch already running stops before its next subscriber. */
  closed: boolean;
}

/**
 * Window in which a self-write token is honoured. The max of the four windows
 * this replaces (pages 350 / entities 500 / releases 500 / plugins 600), so no
 * mount regresses. Resolved at event ARRIVAL, before the debounce — a token
 * consumed at flush time would have to outlive the 300 ms debounce as well.
 */
const SELF_WRITE_WINDOW_MS = 600;

/**
 * Debounce lives EXCLUSIVELY in the mount, independently per mount — rapid
 * writes in one directory never block reactions in another. The subscriber
 * contract contains no debounce of its own.
 *
 * Timers are per file within the mount: a 20-file batch gets 20 timers, but each
 * file's reactions fire exactly once. The window covers tiptap autosave, the fs
 * provider's write stabilization (`awaitWriteFinish`) and the atomic rename an
 * agent's Write tool performs.
 */
const DEBOUNCE_MS = 300;

const AWAIT_WRITE_FINISH = { stabilityThreshold: 80, pollInterval: 20 } as const;


/**
 * M40 provides the broadcast MECHANISM: an event reaches the WS room of the
 * project owning the mount's scope. The EVENT CATALOG does not live in M40 —
 * each event is declared and constructed by its owner, inside the owner's own
 * subscription.
 */
export interface WatchBroadcaster {
  /** `context:<id>` → that project's room. `process` → every live room. */
  broadcast(scope: WatchScope, event: WsEvent): void;
}

export interface FileWatchRuntimeOptions {
  /**
   * When false, mounts register without constructing an `FSWatcher`. The
   * subscription registry, phase ordering and `flush()` all still work — which
   * is how the test harness drives reactions without leaking chokidar fds across
   * the vitest fork pool.
   */
  fsEvents?: boolean;
  /** Room-scoped WS transport. M40 routes; it never authors an event. */
  broadcaster?: WatchBroadcaster;
}

/** Registration surface bound to one scope — `subscribe` inherits it from the registration site. */
export interface ScopedWatchRegistrar {
  readonly scope: WatchScope;
  mountSource(opts: { source: string; dir: string }): void;
  unmountSource(source: string): Promise<void>;
  subscribe(source: string, handler: WatchSubscriber, opts: SubscribeOptions): void;
  markOrigin(source: string, relPath: string, actor: WatchActor): void;
  suppress(source: string, relPath: string): void;
  flush(source: string, relPath: string, event?: WatchEventKind): Promise<void>;
  broadcast(event: WsEvent): void;
  isMounted(source: string): boolean;
  dispose(): Promise<void>;
}

/**
 * Key separator. A character that cannot occur in a scope (`process` /
 * `context:<id>`) or an opaque source name, so `(scope, source, relPath)` keys
 * can never collide by concatenation. Written as an escape rather than a literal
 * control byte — a literal NUL in the first 8 KB makes git treat this file as
 * binary and stop producing reviewable diffs.
 */
const SEP = '\u001f';

function mountKey(scope: WatchScope, source: string): string {
  return `${scope}${SEP}${source}`;
}

function writeKey(scope: WatchScope, source: string, relPath: string): string {
  return `${scope}${SEP}${source}${SEP}${relPath}`;
}

/**
 * Minimal glob → RegExp: supports `**`, `*`, `?` and `{a,b}` alternation. Enough
 * for the three filters this runtime actually uses (`**\/*.{md,mdx}`,
 * `**\/*.html`, `*.json`). Deliberately not a general glob engine — the filter is
 * mechanical path matching, not a query language.
 */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close !== -1) {
        const alts = glob.slice(i + 1, close).split(',');
        out += `(?:${alts.map((a) => a.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')).join('|')})`;
        i = close;
        continue;
      }
      out += '\\{';
    } else if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          // `**/` matches zero or more leading segments.
          out += '(?:[^/]*/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

export class FileWatchRuntime {
  private readonly mounts = new Map<string, Mount>();
  private readonly subs = new Map<string, Subscription[]>();
  /** Content hash of each file as the runtime last left it — see the self-writes section. */
  private readonly selfHash = new Map<string, string>();
  /** Write-back suppress tokens issued outside a dispatch, with expiry. */
  private readonly pendingSuppress = new Map<string, number>();
  /** `markOrigin` labels awaiting their event. Expiry only downgrades the label. */
  private readonly originHint = new Map<string, { actor: WatchActor; until: number }>();
  /** Actor of the in-flight dispatch, so `capture` can read it — see `peekActor`. */
  private readonly dispatchActor = new Map<string, WatchActor>();
  private readonly fsEvents: boolean;
  private broadcaster: WatchBroadcaster | null;

  constructor(opts: FileWatchRuntimeOptions = {}) {
    this.fsEvents = opts.fsEvents !== false;
    this.broadcaster = opts.broadcaster ?? null;
  }

  /** Set late — the WS gateway is built after the runtime in `startServer`. */
  setBroadcaster(b: WatchBroadcaster): void {
    this.broadcaster = b;
  }

  // ---------------------------------------------------------------- mounting

  /**
   * Claim `(scope, source)` and start observing `dir`. The key is the PAIR — the
   * same source in two projects is two different mounts.
   */
  mountSource(opts: { source: string; dir: string; scope: WatchScope }): void {
    const { source, dir, scope } = opts;
    const key = mountKey(scope, source);
    if (this.mounts.has(key)) {
      throw new Error(`[m40] source '${source}' is already mounted in scope '${scope}'`);
    }
    const mount: Mount = {
      source,
      scope,
      dir,
      fsw: null,
      timers: new Map(),
      pending: new Map(),
      inflight: new Map(),
      closed: false,
    };
    this.mounts.set(key, mount);
    if (!this.fsEvents) return;

    const fsw = chokidar.watch(dir, {
      ignoreInitial: true,
      ignored: makeWatchIgnore(dir),
      awaitWriteFinish: AWAIT_WRITE_FINISH,
    });
    fsw.on('add', (p) => this.onFsEvent(mount, 'add', p));
    fsw.on('change', (p) => this.onFsEvent(mount, 'change', p));
    fsw.on('unlink', (p) => this.onFsEvent(mount, 'unlink', p));
    // EMFILE (and other watch errors) arrive on 'error' — without a listener Node
    // escalates them to an uncaught exception that kills the process. Log instead,
    // so a transient watch failure stays non-fatal.
    fsw.on('error', (err) => console.error(`[m40] watch error on ${scope}/${source}:`, err));
    mount.fsw = fsw;
  }

  async unmountSource(source: string, scope: WatchScope): Promise<void> {
    const key = mountKey(scope, source);
    const mount = this.mounts.get(key);
    if (!mount) return;
    this.mounts.delete(key);
    this.subs.delete(key);
    for (const t of mount.timers.values()) clearTimeout(t);
    mount.timers.clear();
    mount.pending.clear();
    await mount.fsw?.close();
    // Do NOT await in-flight work here: `unmountSource` is on the dispose hot path
    // and a handler that re-enters the runtime would deadlock against its own
    // dispatch. The `closed` flag below stops the chain instead, and
    // `disposeScope` drains with a bound.
    mount.closed = true;
  }

  // ----------------------------------------------------------- subscriptions

  /**
   * Register a reaction. Validation is FAIL-FAST at registration, never queued:
   * subscribing to an unmounted source throws. That is why "no predecessor" at
   * dispatch is always the consequence of an owner's gate, never a registration race.
   */
  subscribe(source: string, handler: WatchSubscriber, opts: SubscribeOptions & { scope: WatchScope }): void {
    const { scope, id, phase, after = [], filter } = opts;
    const key = mountKey(scope, source);
    if (!this.mounts.has(key)) {
      throw new Error(`[m40] cannot subscribe '${id}' to unmounted source '${source}' in scope '${scope}'`);
    }
    if (PHASE_NAMES.has(id)) {
      throw new Error(`[m40] subscription id '${id}' collides with a reserved phase name`);
    }
    if (!(phase in PHASE_RANK)) {
      throw new Error(`[m40] unknown phase '${phase}' for subscription '${id}'`);
    }
    const list = this.subs.get(key) ?? [];
    if (list.some((s) => s.id === id)) {
      throw new Error(`[m40] duplicate subscription id '${id}' on source '${source}' in scope '${scope}'`);
    }

    const ownRank = PHASE_RANK[phase];
    for (const dep of after) {
      if (PHASE_NAMES.has(dep)) {
        if (PHASE_RANK[dep as WatchPhase] > ownRank) {
          throw new Error(`[m40] '${id}' (${phase}) cannot depend on later phase '${dep}'`);
        }
        continue;
      }
      const target = list.find((s) => s.id === dep);
      if (target && PHASE_RANK[target.phase] > ownRank) {
        throw new Error(`[m40] '${id}' (${phase}) cannot depend on '${dep}' from later phase '${target.phase}'`);
      }
    }
    // The reverse check: an already-registered subscription may name THIS id, and
    // only now can we see which phase it lands in. Catches both registration orders.
    for (const existing of list) {
      if (existing.after.includes(id) && ownRank > PHASE_RANK[existing.phase]) {
        throw new Error(
          `[m40] '${existing.id}' (${existing.phase}) cannot depend on '${id}' from later phase '${phase}'`,
        );
      }
    }

    list.push({ id, phase, after, filter: filter ? globToRegExp(filter) : undefined, handler });
    this.subs.set(key, list);
  }

  // ------------------------------------------------------------- self-writes

  /**
   * How the runtime recognizes its OWN writes.
   *
   * The first design counted tokens: one token per write, consumed one per fs
   * event. That is unsound, because the relationship between writes and events is
   * not 1:1 — chokidar's `awaitWriteFinish` deliberately coalesces a burst into a
   * single event, and a slow write can split into several. Any leftover token then
   * swallowed a LATER, genuine write, which (with `capture` as the sole author of
   * `file_version`) silently lost the user's edit.
   *
   * So identity is by CONTENT, not by counting: after every write the runtime
   * drove, it records the file's hash. An incoming event whose current content
   * hashes to that value is our own echo, however many events the provider chose
   * to emit. Anything else is a genuine external edit.
   *
   * The one deliberate blind spot: an external edit that restores a file to
   * byte-identical content is treated as an echo. Nothing observable depends on
   * it — every projection would compute the same result.
   */
  private hashFile(dir: string, relPath: string): string | null {
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, relPath))).digest('hex');
    } catch {
      return null; // gone, or unreadable — nothing to compare against
    }
  }

  /** Record the file as the runtime just left it, so its echo is recognizable. */
  private stampSelfHash(mount: Mount, relPath: string): void {
    const key = writeKey(mount.scope, mount.source, relPath);
    const hash = this.hashFile(mount.dir, relPath);
    if (hash === null) this.selfHash.delete(key);
    else this.selfHash.set(key, hash);
  }

  /**
   * Label a server write. Does NOT suppress: the event travels on with
   * `origin: 'server'` and every phase runs normally. Called before EVERY server
   * write, so the UI can tell its own write from an external edit.
   *
   * This is a LABEL only — if it expires unused the write is merely reported as
   * `external`, never dropped.
   */
  markOrigin(scope: WatchScope, source: string, relPath: string, actor: WatchActor): void {
    this.originHint.set(writeKey(scope, source, relPath), { actor, until: Date.now() + SELF_WRITE_WINDOW_MS });
  }

  /**
   * Swallow the event entirely — no phase runs. Called ONLY by write-backs,
   * immediately before writing into an observed directory, to break the
   * "my write → my reaction → another write" loop.
   *
   * A reaction that does not WRITE into the observed directory never uses this;
   * using it for an ordinary server write is a bug (that is what `markOrigin` is for).
   *
   * A suppress issued from INSIDE a dispatch needs no token at all — the
   * post-dispatch hash stamp already covers that write — so the dispatch clears it
   * on the way out. The token exists for write primitives that run outside any
   * dispatch (the entity and release stores), where there is nothing to stamp
   * against until the event arrives.
   */
  suppress(scope: WatchScope, source: string, relPath: string): void {
    this.pendingSuppress.set(writeKey(scope, source, relPath), Date.now() + SELF_WRITE_WINDOW_MS);
  }

  /**
   * The actor behind the write currently being dispatched for this key, if it was
   * a server write.
   *
   * The event tuple carries `origin` only, binary — but M17's `changed_by` needs
   * three values. Rather than widen the tuple, the actor recorded by `markOrigin`
   * is retained for exactly the duration of the dispatch it belongs to, and
   * `capture` reads it here: `server`+`user` → `user`, `server`+`agent` → `agent`,
   * `external` → `filesystem`.
   */
  peekActor(scope: WatchScope, source: string, relPath: string): WatchActor | undefined {
    const key = writeKey(scope, source, relPath);
    const live = this.dispatchActor.get(key);
    if (live) return live;
    const hint = this.originHint.get(key);
    return hint && Date.now() < hint.until ? hint.actor : undefined;
  }

  /** Consume the origin label, if one is still live. */
  private takeOrigin(scope: WatchScope, source: string, relPath: string): WatchActor | undefined {
    const key = writeKey(scope, source, relPath);
    const hint = this.originHint.get(key);
    if (!hint) return undefined;
    this.originHint.delete(key);
    if (Date.now() >= hint.until) return undefined;
    this.dispatchActor.set(key, hint.actor);
    return hint.actor;
  }

  /** Consume a pending suppress token, if one is still live. */
  private takeSuppress(scope: WatchScope, source: string, relPath: string): boolean {
    const key = writeKey(scope, source, relPath);
    const until = this.pendingSuppress.get(key);
    if (until === undefined) return false;
    this.pendingSuppress.delete(key);
    return Date.now() < until;
  }

  // ------------------------------------------------------------------- flush

  /**
   * Drive the full reaction chain for `(scope, source, relPath)` to completion.
   *
   * Contract-level, not fs-level: it does not "drain chokidar", it guarantees the
   * reactions for this key have finished. It coalesces with a pending debounce
   * timer for the same key, and runs the chain even when the fs provider queued
   * nothing at all — which is what makes a server write read-after-write
   * consistent (`markOrigin` → write → `await flush` → HTTP 200), and what lets
   * the runtime work with `fsEvents: false`.
   *
   * It honours a live `suppress()` (AC: a suppressed write runs no reaction), but
   * CONSUMES the token in doing so. The earlier design left tokens behind and
   * popped the oldest of a queue, so a stale token from one write silently dropped
   * the NEXT one — losing the user's edit outright once `capture` became the sole
   * author of `file_version`. Nothing lingers now: a token issued by a write-back
   * inside a dispatch is cleared when that dispatch ends, and echo recognition is
   * by content hash rather than by counting events.
   */
  async flush(scope: WatchScope, source: string, relPath: string, event: WatchEventKind = 'change'): Promise<void> {
    const mount = this.mounts.get(mountKey(scope, source));
    if (!mount) return;

    const timer = mount.timers.get(relPath);
    if (timer) {
      clearTimeout(timer);
      mount.timers.delete(relPath);
    }
    const queued = mount.pending.get(relPath);
    mount.pending.delete(relPath);

    let resolvedEvent: WatchEventKind;
    let origin: WatchOrigin;
    if (queued) {
      // A queued event already resolved its origin when it arrived.
      resolvedEvent = queued.event;
      origin = queued.origin;
    } else {
      if (this.takeSuppress(scope, source, relPath)) {
        this.stampSelfHash(mount, relPath);
        await mount.inflight.get(relPath);
        return;
      }
      origin = this.takeOrigin(scope, source, relPath) ? 'server' : 'external';
      resolvedEvent = event;
    }

    await mount.inflight.get(relPath);
    await this.dispatch(mount, relPath, resolvedEvent, origin);
  }

  // --------------------------------------------------------------- broadcast

  broadcast(scope: WatchScope, event: WsEvent): void {
    this.broadcaster?.broadcast(scope, event);
  }

  // ---------------------------------------------------------------- dispatch

  private onFsEvent(mount: Mount, event: WatchEventKind, absPath: string): void {
    const relPath = path.relative(mount.dir, absPath).replaceAll(path.sep, '/');
    if (!relPath || relPath.startsWith('..')) return;
    const key = writeKey(mount.scope, mount.source, relPath);

    if (event === 'unlink') {
      // Nothing to hash — a delete falls back to the token, and clears any stamp.
      this.selfHash.delete(key);
      if (this.takeSuppress(mount.scope, mount.source, relPath)) return;
    } else {
      // Our own echo, whether the provider emitted one event for several writes
      // or several for one.
      const hash = this.hashFile(mount.dir, relPath);
      if (hash !== null && this.selfHash.get(key) === hash) return;
      if (this.takeSuppress(mount.scope, mount.source, relPath)) {
        // A write made outside any dispatch (the entity/release store primitives).
        // Record what it left behind so its later echoes are recognized too.
        if (hash !== null) this.selfHash.set(key, hash);
        return;
      }
    }

    const origin: WatchOrigin = this.takeOrigin(mount.scope, mount.source, relPath) ? 'server' : 'external';
    mount.pending.set(relPath, { event, origin });
    const prev = mount.timers.get(relPath);
    if (prev) clearTimeout(prev);
    mount.timers.set(
      relPath,
      setTimeout(() => {
        mount.timers.delete(relPath);
        const queued = mount.pending.get(relPath);
        mount.pending.delete(relPath);
        if (!queued) return;
        void this.dispatch(mount, relPath, queued.event, queued.origin);
      }, DEBOUNCE_MS),
    );
  }

  /**
   * Run every matching subscription for this event, phase by phase.
   *
   * `after` is resolved PER SOURCE, AT DISPATCH TIME — not at registration — so
   * dispatch never depends on build-hook ordering. A predecessor missing at
   * dispatch is NOT an error: the dependency counts as satisfied and the
   * subscriber runs on its own (that is how a root without `sectionIndexed`
   * leaves M14 with no M06 to wait for).
   */
  private dispatch(mount: Mount, relPath: string, event: WatchEventKind, origin: WatchOrigin): Promise<void> {
    const run = (async () => {
      const all = this.subs.get(mountKey(mount.scope, mount.source)) ?? [];
      const matching = all.filter((s) => !s.filter || s.filter.test(relPath));
      if (matching.length === 0) return;

      for (const phase of PHASE_ORDER) {
        const inPhase = matching.filter((s) => s.phase === phase);
        if (inPhase.length === 0) continue;
        for (const sub of orderWithinPhase(inPhase)) {
          // The context that owns this mount closes its database right after
          // disposing the scope. Stop advancing the chain the moment the mount is
          // gone, so no later subscriber runs against a closed handle.
          if (mount.closed) return;
          try {
            if (event === 'unlink') {
              await sub.handler.onUnlink(mount.scope, mount.source, relPath, origin);
            } else {
              await sub.handler.onChange(mount.scope, mount.source, relPath, origin);
            }
          } catch (err) {
            // One subscriber's failure never aborts the dispatch for the rest — a
            // late-phase subscriber that finds the file already gone skips it
            // idempotently rather than derailing its siblings.
            console.error(`[m40] subscription '${sub.id}' failed on ${mount.source}:${relPath}:`, err);
          }
        }
      }
    })();

    // Chain so `flush()` can await work already in flight for this key.
    const chained: Promise<void> = run.finally(() => {
      const key = writeKey(mount.scope, mount.source, relPath);
      // Whatever the write-backs left on disk is now OUR content: stamp it so the
      // resulting echoes are recognized. This also subsumes any `suppress()` a
      // write-back issued during the dispatch, so no token outlives it.
      if (event === 'unlink') this.selfHash.delete(key);
      else this.stampSelfHash(mount, relPath);
      this.pendingSuppress.delete(key);
      this.dispatchActor.delete(key);
      if (mount.inflight.get(relPath) === chained) mount.inflight.delete(relPath);
    });
    mount.inflight.set(relPath, chained);
    return chained;
  }

  // ------------------------------------------------------------------- scope

  scoped(scope: WatchScope): ScopedWatchRegistrar {
    return {
      scope,
      mountSource: (opts) => this.mountSource({ ...opts, scope }),
      unmountSource: (source) => this.unmountSource(source, scope),
      subscribe: (source, handler, opts) => this.subscribe(source, handler, { ...opts, scope }),
      markOrigin: (source, relPath, actor) => this.markOrigin(scope, source, relPath, actor),
      suppress: (source, relPath) => this.suppress(scope, source, relPath),
      flush: (source, relPath, event) => this.flush(scope, source, relPath, event),
      broadcast: (event) => this.broadcast(scope, event),
      isMounted: (source) => this.isMounted(source, scope),
      dispose: () => this.disposeScope(scope),
    };
  }

  /**
   * Context dispose (LRU eviction): unmount every mount of THIS scope, drop its
   * subscriptions and settle its pending timers. `scope: 'process'` mounts and
   * other contexts' mounts stay active.
   */
  async disposeScope(scope: WatchScope): Promise<void> {
    const owned = [...this.mounts.values()].filter((m) => m.scope === scope);
    for (const m of owned) await this.unmountSource(m.source, scope);
    const prefix = `${scope}${SEP}`;
    for (const m of [this.selfHash, this.pendingSuppress, this.originHint] as Array<Map<string, unknown>>) {
      for (const key of [...m.keys()]) if (key.startsWith(prefix)) m.delete(key);
    }
    for (const key of [...this.dispatchActor.keys()]) {
      if (key.startsWith(prefix)) this.dispatchActor.delete(key);
    }
  }

  /** Process shutdown. */
  async close(): Promise<void> {
    for (const mount of [...this.mounts.values()]) {
      await this.unmountSource(mount.source, mount.scope);
    }
    this.selfHash.clear();
    this.pendingSuppress.clear();
    this.originHint.clear();
    this.dispatchActor.clear();
  }

  isMounted(source: string, scope: WatchScope): boolean {
    return this.mounts.has(mountKey(scope, source));
  }
}

/**
 * Topological sort by intra-phase `after` edges. Edges pointing outside the phase
 * (a phase name, or an id not registered here) are ignored — cross-phase
 * dependencies are already satisfied by phase ordering, and a missing predecessor
 * counts as satisfied. Registration order breaks ties, and a cycle degrades to
 * registration order rather than dropping anyone.
 */
function orderWithinPhase(subs: Subscription[]): Subscription[] {
  const byId = new Map(subs.map((s) => [s.id, s] as const));
  const out: Subscription[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (sub: Subscription): void => {
    const s = state.get(sub.id);
    if (s === 'done' || s === 'visiting') return;
    state.set(sub.id, 'visiting');
    for (const dep of sub.after) {
      const target = byId.get(dep);
      if (target) visit(target);
    }
    state.set(sub.id, 'done');
    out.push(sub);
  };

  for (const sub of subs) visit(sub);
  return out;
}

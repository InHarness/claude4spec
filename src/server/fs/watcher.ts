import { AsyncLocalStorage } from 'node:async_hooks';
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
 * Execution order. `write-back` runs FIRST, then the three mutually independent
 * phases, then `capture`.
 *
 * 0.2.76 moved `write-back` to the front. It is the only phase that MUTATES the
 * file, so everything that reads the file has to run after it. Anchor injection
 * adds lines; a section index holds line ranges; an index computed before
 * `write-back` describes a file that no longer exists at the end of the chain,
 * with coordinates shifted by exactly what was injected. A later write against
 * those stale coordinates CORRUPTS content rather than merely showing a stale
 * view — that defect is what forced the order.
 *
 * `capture` stays last: anchor writes are suppressed, so they never fire a
 * second capture, and a snapshot taken before injection would be the only
 * version in the log — freezing content that never existed on disk as a final
 * state, with a `content_hash` diverging from the file.
 *
 * Consequence for subscribers: a `write-back` reads the FILE, never a
 * projection, and always sees the state before its own write. The existing
 * `after: [write-back]` declarations are now satisfied BY CONSTRUCTION; they are
 * kept as redundant documentation of intent rather than removed.
 */
const PHASE_RANK: Record<WatchPhase, number> = {
  'write-back': 0,
  projection: 1,
  notification: 1,
  reload: 1,
  capture: 2,
};

/** Rank-1 phases run in this order; ranks then run 0 → 1 → 2. */
const PHASE_ORDER: WatchPhase[] = ['write-back', 'projection', 'notification', 'reload', 'capture'];

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
 * A suppress token's owner, which decides who is allowed to retire it.
 *
 * `'chain'` — issued by a write-back from inside a running dispatch (arm 2 of
 * `suppress`). The dispatch's own hash stamp already covers that write, so the
 * dispatch clears it on the way out, exactly as before.
 *
 * `'primitive'` — issued by the record store immediately before its atomic
 * write (arm 1). It is retired by its ISSUER, unconditionally, and NOT by the
 * first matching event: a write that changes no byte produces no event at all,
 * and an atomic `temp -> rename` is reported as one `change` by some providers
 * and as `unlink` + `add` by others. Either way a one-shot token would either
 * linger and swallow somebody else's later event, or be eaten by the first of a
 * pair and let the second through.
 */
type SuppressOwner = 'chain' | 'primitive';

interface SuppressToken {
  until: number;
  owner: SuppressOwner;
}

/**
 * How long a primitive's token outlives the settled chain.
 *
 * The chain runs in-band and has already finished when the caller is answered,
 * but the file provider may report the write LATER — after the debounce, after
 * the response. The token therefore survives a guard window of the source's
 * debounce plus a margin.
 *
 * Named cost: a genuinely external write landing on the same path inside that
 * window is swallowed and runs no chain. State returns to agreement on the next
 * write of that path, or on a full rebuild.
 */
const SUPPRESS_GUARD_MS = 300 + SELF_WRITE_WINDOW_MS;

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
 * What a chain run reports back to the caller that drove it.
 *
 * The chain never fails an operation: past the commit point there is no
 * "failure", only success or success WITH A WARNING (0.2.76 phase error
 * classes). `projection` is the one critical phase — it gets one automatic
 * retry, and a second failure marks the projection stale and lands here as a
 * warning. Every other phase is incidental: its error is logged and changes
 * nothing.
 */
export interface ChainResult {
  /** Subscription ids whose critical phase failed twice. Empty on a clean run. */
  staleProjections: string[];
}

/** The `(scope, source, relPath)` a dispatch is currently running for. */
export interface DispatchContext {
  scope: WatchScope;
  source: string;
  relPath: string;
}

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
  suppress(source: string, relPath: string, owner?: SuppressOwner): void;
  /** Hand a suppress token back when the write it covered failed. */
  unsuppress(source: string, relPath: string): void;
  /**
   * Run the reaction chain in-band, with the origin the CALLER declares.
   *
   * The second trigger of the two (`flush`/the watcher being the first). It is
   * NOT a second registration: M42 mounts nothing and subscribes to nothing —
   * it dispatches over the registry the directory owners and subscribers built.
   *
   * Unlike `flush` it never consults a suppress token: the primitive holds its
   * own token across this call precisely so the provider's echo is swallowed,
   * and a chain that honoured it would run no phase at all.
   */
  runChain(
    source: string,
    relPath: string,
    event: WatchEventKind,
    origin: WatchOrigin,
    actor?: WatchActor,
  ): Promise<ChainResult>;
  /** Retire a `'primitive'` token once its chain has settled, after a guard window. */
  releaseSuppress(source: string, relPath: string): void;
  flush(source: string, relPath: string, event?: WatchEventKind): Promise<void>;
  broadcast(event: WsEvent): void;
  isMounted(source: string): boolean;
  /** The key of the dispatch running on this call stack, if any. */
  currentDispatch(): DispatchContext | undefined;
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
  /** Suppress tokens, with expiry and the owner entitled to retire them. */
  private readonly pendingSuppress = new Map<string, SuppressToken>();
  /** Pending guard-window timers for primitive-owned tokens, so dispose can clear them. */
  private readonly suppressTimers = new Map<string, NodeJS.Timeout>();
  /**
   * The dispatch running on the current call stack.
   *
   * `AsyncLocalStorage` rather than a flag or a Set: dispatches are concurrent
   * across paths (`mount.inflight` is keyed per relPath), so a process-wide
   * marker would attribute one path's chain to another's write. The record
   * store reads this to recognise a write-back into the chain's OWN file, which
   * must neither re-acquire that path's mutex nor start a second chain.
   */
  private readonly dispatchAls = new AsyncLocalStorage<DispatchContext>();
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
   * Label a change the app CAUSED but did not itself write.
   *
   * 0.2.76 narrowed this. It used to cover UI auto-save, rename propagation and
   * restore — anything the server wrote byte for byte. Now that every write of
   * specification content goes through the M42 primitive, a server write
   * suppresses its own event and runs the chain in-band with `origin: 'server'`
   * directly, so **`markOrigin` no longer means "the app wrote this"**.
   *
   * What is left is the other class: a branch checked out from the UI, an
   * archive unpacked, an external tool run. The chain MUST run from the
   * `watcher` trigger — that is the only way to see the change at all — but the
   * UI must not show a "changed externally" dialog for something the user just
   * asked for. Suppression would take both; labelling gives only the provenance.
   *
   * Called by whoever CAUSES the change, before causing it. A label that expires
   * unused merely reports the change as `external`; it never drops it.
   */
  markOrigin(scope: WatchScope, source: string, relPath: string, actor: WatchActor): void {
    this.originHint.set(writeKey(scope, source, relPath), { actor, until: Date.now() + SELF_WRITE_WINDOW_MS });
  }

  /**
   * Swallow the event entirely — no phase runs for it.
   *
   * 0.2.76 — exactly two legal arms; any other call is a bug.
   *
   * 1. **From the write primitive that runs the chain itself.** Suppression and
   *    the in-band call are ONE act: the event is redundant because the chain
   *    already ran synchronously and settled before the provider reported
   *    anything. This covers every write of spec content — pages, entities,
   *    tags, plans, briefs, patches, release metadata.
   * 2. **From a write-back inside a running chain, writing to the file that
   *    chain is handling.** Without it the write would fire its own reaction,
   *    which would write again, and loop. This is what legalises anchor
   *    injection (M06) and build-artifact materialisation (M33).
   *
   * A write-back to a DIFFERENT file than the chain's is not arm 2 — it goes
   * through the primitive and lands in arm 1.
   *
   * The old rule "`suppress` on an ordinary server write is a bug, `markOrigin`
   * is correct there" is withdrawn as historically true but no longer current:
   * it held only while a server write existed that did not go through the
   * primitive. None does.
   *
   * Token lifetime: see {@link SuppressToken}. An arm-2 token is cleared by the
   * dispatch that encloses it; an arm-1 token is retired by its issuer through
   * {@link releaseSuppress}, unconditionally, however many events arrived —
   * including none.
   */
  suppress(scope: WatchScope, source: string, relPath: string, owner: SuppressOwner = 'chain'): void {
    const key = writeKey(scope, source, relPath);
    const existing = this.suppressTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.suppressTimers.delete(key);
    }
    this.pendingSuppress.set(key, {
      until: Date.now() + (owner === 'primitive' ? SUPPRESS_GUARD_MS : SELF_WRITE_WINDOW_MS),
      owner,
    });
  }

  /**
   * Retire a primitive's token after its chain has settled, plus a guard window.
   *
   * Not immediate: the file provider may report the write after the caller has
   * already been answered, so the token has to outlive the response by the
   * source's debounce plus a margin.
   */
  releaseSuppress(scope: WatchScope, source: string, relPath: string): void {
    const key = writeKey(scope, source, relPath);
    const existing = this.suppressTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.suppressTimers.delete(key);
      const token = this.pendingSuppress.get(key);
      // Only retire our OWN token: a later writer may already have replaced it.
      if (token?.owner === 'primitive') this.pendingSuppress.delete(key);
    }, SUPPRESS_GUARD_MS);
    // Never hold the process open for a suppression token.
    timer.unref?.();
    this.suppressTimers.set(key, timer);
  }

  /**
   * Give a suppress token back, for the write that never happened.
   *
   * `suppress()` is issued BEFORE the write, so a write that throws leaves a live
   * token behind with no event of its own to consume it — and the next genuine
   * edit inside the window is silently swallowed instead. That is the failure the
   * `fs` suite already documents ("a suppress that never gets its event").
   *
   * Deliberately NOT the clear half of a set/clear pair. A token is still
   * one-shot and still expires on its own; this only lets a caller that KNOWS its
   * write failed hand the token back early. Calling it after a write that
   * succeeded would resurrect the echo the suppression exists to eat.
   *
   * Not concurrency-safe per key, and cannot be made so here: `pendingSuppress`
   * holds ONE token per key, so two overlapping writers already collapse into a
   * single token at `suppress()` time — the second one's echo dispatches as
   * external whether or not either write fails. Tagging tokens with an id would
   * not close that; only refcounting would, and a count that outlives its events
   * is a worse failure than the one it fixes.
   */
  unsuppress(scope: WatchScope, source: string, relPath: string): void {
    const key = writeKey(scope, source, relPath);
    const timer = this.suppressTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.suppressTimers.delete(key);
    }
    this.pendingSuppress.delete(key);
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

  /**
   * Does a live suppress token cover this path?
   *
   * 0.2.76 — a matching event PEEKS rather than consumes. "The token lives until
   * the first matching event" is named and rejected in {@link SuppressToken}: it
   * cannot survive a write that changes no byte (no event at all) nor an atomic
   * rename reported as an `unlink` + `add` pair. An arm-2 token is retired by
   * the enclosing dispatch, an arm-1 token by its issuer.
   */
  private peekSuppress(scope: WatchScope, source: string, relPath: string): boolean {
    const key = writeKey(scope, source, relPath);
    const token = this.pendingSuppress.get(key);
    if (token === undefined) return false;
    if (Date.now() < token.until) return true;
    // Expired: retire it here so it cannot mask a later event.
    this.pendingSuppress.delete(key);
    return false;
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
   * It honours a live `suppress()` (AC: a suppressed write runs no reaction). It
   * PEEKS at the token rather than consuming it: since 0.2.76 a token has an
   * owner and a lifetime, and consuming someone else's would reopen the hole it
   * was issued to close. So `flush()` on a path the record store is holding a
   * `'primitive'` token for is a no-op for that token's guard window, not for a
   * single event — which is correct, because within that window the primitive
   * has already run the chain in-band and there is nothing left to flush.
   *
   * The queue this replaced was the real defect: it popped the OLDEST of a stack
   * of tokens, so a stale one from one write silently dropped the NEXT — losing
   * the user's edit outright once `capture` became the sole author of
   * `file_version`. Nothing lingers now: a token issued by a write-back inside a
   * dispatch is cleared when that dispatch ends, a token issued by the primitive
   * is retired by its issuer, and echo recognition is by content hash rather
   * than by counting events.
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
      if (this.peekSuppress(scope, source, relPath)) {
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
      if (this.peekSuppress(mount.scope, mount.source, relPath)) return;
    } else {
      // Our own echo, whether the provider emitted one event for several writes
      // or several for one.
      const hash = this.hashFile(mount.dir, relPath);
      if (hash !== null && this.selfHash.get(key) === hash) return;
      if (this.peekSuppress(mount.scope, mount.source, relPath)) {
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
  private dispatch(
    mount: Mount,
    relPath: string,
    event: WatchEventKind,
    origin: WatchOrigin,
  ): Promise<ChainResult> {
    const ctx: DispatchContext = { scope: mount.scope, source: mount.source, relPath };
    const staleProjections: string[] = [];

    const run = this.dispatchAls.run(ctx, async () => {
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
          const failure = await this.runSubscriber(mount, sub, relPath, event, origin);
          if (!failure) continue;
          /**
           * 0.2.76 phase error classes.
           *
           * `projection` is CRITICAL: an index that silently did not update is
           * a wrong answer, not a missing one. One automatic retry, and on a
           * second failure the projection is marked stale and the fact is
           * reported to the caller. The operation still SUCCEEDS — with a
           * warning. Nothing is ever rolled back: the commit point is the file
           * on disk, and undoing it would be another write, another suppression
           * and a recursion risk.
           *
           * Every other phase is INCIDENTAL: the error is logged and changes
           * neither the operation's result nor the remaining phases of this
           * run. A missing version-log row loses history; it does not damage
           * content.
           */
          if (sub.phase !== 'projection') {
            console.error(`[m40] subscription '${sub.id}' failed on ${mount.source}:${relPath}:`, failure);
            continue;
          }
          if (mount.closed) return;
          const retry = await this.runSubscriber(mount, sub, relPath, event, origin);
          if (!retry) continue;
          staleProjections.push(sub.id);
          console.error(
            `[m40] projection '${sub.id}' failed twice on ${mount.source}:${relPath} — marking it stale:`,
            retry,
          );
          this.broadcast(mount.scope, {
            kind: 'projection:stale',
            source: mount.source,
            path: relPath,
            subscription: sub.id,
          });
        }
      }
    });

    // Chain so `flush()` can await work already in flight for this key.
    // The tail `flush()` awaits. Kept as its own handle because the chain's own
    // promise resolves a ChainResult, and `inflight` only cares that it settled.
    let tail: Promise<void>;
    const chained: Promise<ChainResult> = run
      .then(() => ({ staleProjections }))
      .finally(() => {
        const key = writeKey(mount.scope, mount.source, relPath);
        // Whatever the write-backs left on disk is now OUR content: stamp it so the
        // resulting echoes are recognized.
        if (event === 'unlink') this.selfHash.delete(key);
        else this.stampSelfHash(mount, relPath);
        /**
         * Clear only a token this dispatch's own write-backs issued (arm 2) —
         * the post-dispatch stamp above already covers those writes. A
         * `'primitive'` token belongs to the caller that wrapped this chain and
         * must outlive it by its guard window, or the provider's late echo
         * would dispatch a second time.
         */
        if (this.pendingSuppress.get(key)?.owner === 'chain') this.pendingSuppress.delete(key);
        this.dispatchActor.delete(key);
        if (mount.inflight.get(relPath) === tail) mount.inflight.delete(relPath);
      });
    tail = chained.then(
      () => undefined,
      () => undefined,
    );
    mount.inflight.set(relPath, tail);
    return chained;
  }

  /** One subscriber call. Returns the error it threw, or `null` on success. */
  private async runSubscriber(
    mount: Mount,
    sub: Subscription,
    relPath: string,
    event: WatchEventKind,
    origin: WatchOrigin,
  ): Promise<unknown> {
    try {
      if (event === 'unlink') {
        await sub.handler.onUnlink(mount.scope, mount.source, relPath, origin);
      } else {
        await sub.handler.onChange(mount.scope, mount.source, relPath, origin);
      }
      return null;
    } catch (err) {
      return err ?? new Error('subscriber threw a falsy value');
    }
  }

  /**
   * The SECOND trigger: run the chain now, with the origin the caller declares.
   *
   * Called synchronously by the record store right after its commit point, and
   * returns only once every phase has settled — which is the sole reason a write
   * operation can answer with settled state instead of the state before its own
   * reactions.
   *
   * The trigger is INVISIBLE to subscribers: the same `onChange` / `onUnlink`
   * contract either way. Only `origin` distinguishes them, and M40 does not pass
   * the trigger itself. A two-trigger reaction is still ONE registration.
   *
   * It deliberately does not consult `pendingSuppress`: the caller holds a token
   * across this call so the provider's echo is swallowed, and honouring it here
   * would run no phase at all.
   */
  async runChain(
    scope: WatchScope,
    source: string,
    relPath: string,
    event: WatchEventKind,
    origin: WatchOrigin,
    actor?: WatchActor,
  ): Promise<ChainResult> {
    const mount = this.mounts.get(mountKey(scope, source));
    if (!mount) return { staleProjections: [] };
    /**
     * The actor travels as an argument now, not as a `markOrigin` label left
     * lying around before the write. `origin` is binary and M17's `changed_by`
     * needs three values, so `capture` still reads it through `peekActor` — it
     * is simply set by the caller that KNOWS, for exactly this dispatch.
     */
    // A queued watcher event for this path is now redundant — this chain covers it.
    const timer = mount.timers.get(relPath);
    if (timer) {
      clearTimeout(timer);
      mount.timers.delete(relPath);
    }
    mount.pending.delete(relPath);
    await mount.inflight.get(relPath);
    /**
     * Set the actor AFTER the wait, never before it. A dispatch already in
     * flight for this same path — an external edit whose debounce fired first —
     * clears the actor key in its own `.finally`, and the path mutex does not
     * serialize watcher-driven dispatches against ours. Setting it earlier let
     * that dispatch wipe our label on the way out, and `capture` then recorded
     * an agent's write as `changed_by: 'user'`.
     */
    if (actor) this.dispatchActor.set(writeKey(scope, source, relPath), actor);
    return await this.dispatch(mount, relPath, event, origin);
  }

  /** The dispatch running on this call stack, if any. */
  currentDispatch(): DispatchContext | undefined {
    return this.dispatchAls.getStore();
  }

  // ------------------------------------------------------------------- scope

  scoped(scope: WatchScope): ScopedWatchRegistrar {
    return {
      scope,
      mountSource: (opts) => this.mountSource({ ...opts, scope }),
      unmountSource: (source) => this.unmountSource(source, scope),
      subscribe: (source, handler, opts) => this.subscribe(source, handler, { ...opts, scope }),
      markOrigin: (source, relPath, actor) => this.markOrigin(scope, source, relPath, actor),
      suppress: (source, relPath, owner) => this.suppress(scope, source, relPath, owner),
      unsuppress: (source, relPath) => this.unsuppress(scope, source, relPath),
      runChain: (source, relPath, event, origin, actor) =>
        this.runChain(scope, source, relPath, event, origin, actor),
      releaseSuppress: (source, relPath) => this.releaseSuppress(scope, source, relPath),
      flush: (source, relPath, event) => this.flush(scope, source, relPath, event),
      broadcast: (event) => this.broadcast(scope, event),
      isMounted: (source) => this.isMounted(source, scope),
      currentDispatch: () => this.currentDispatch(),
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
    // Guard-window timers first: a timer that outlived its scope would fire
    // against a context whose mounts and database are already gone.
    for (const [key, timer] of [...this.suppressTimers]) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(timer);
      this.suppressTimers.delete(key);
    }
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
    for (const timer of this.suppressTimers.values()) clearTimeout(timer);
    this.suppressTimers.clear();
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

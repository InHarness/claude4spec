import fs from 'node:fs';
import path from 'node:path';
import type { RecordFormatAdapter } from './record-adapters.js';
import type { ChainResult, ScopedWatchRegistrar, WatchActor, WatchEventKind, WatchOrigin } from './watcher.js';

/**
 * M42 — Record Store (0.2.76). The ONLY writer of specification content.
 *
 * Until 0.2.75 the shape of a write — check the conflict, swap the file
 * atomically, suppress your own event, bring the indexes back into agreement —
 * was written independently in several places: once for pages, once for entity
 * files, once for release metadata, and for chat artifacts not at all. Each
 * drifted at its own pace, and the most frequently written store (pages) did not
 * even claim atomicity.
 *
 * This primitive owns no directory it writes to, brings no tables, validates
 * nothing and knows nothing about what the content MEANS. It runs one fixed
 * sequence of six steps with ONE commit point:
 *
 *   1. Conflict check — `expectedHash` against the hash of the state on disk.
 *      Before the write and before serialization.
 *   2. Serialization through the format adapter. The only format-aware step.
 *   3. Atomic `temp → rename`. THE COMMIT POINT. Nothing past here is undone.
 *   4. Suppression token, issued immediately before step 3 and not earlier.
 *   5. The phase chain, run synchronously (`runChain`).
 *   6. The answer, read off the state AFTER the `write-back` phase.
 *
 * Steps 1–2 can fail CLEANLY: nothing is written. From step 3 on there is no
 * "failure" left — only success, or success with a warning.
 *
 * ## Concurrency — serialized per path
 *
 * Two concurrent writes to the same path are SERIALIZED, not refused. The mutex
 * is keyed `(scope, source, relPath)`; the second writer waits until the first
 * has fully settled and only then enters step 1, so its `expectedHash` is
 * checked against what the first actually left. The usual outcome is an ordinary
 * conflict, and that is the INTENDED outcome: the second writer learns it was
 * writing against stale state instead of silently overwriting it.
 *
 * The critical section spans steps 1–6, not the write alone. Ending it at the
 * commit would let the second write's chain interleave with the first's on the
 * same file, and the `projection` phase would compute an index against state
 * that no longer exists.
 *
 * The mutex is per PATH, not per source or project — different files in one
 * source still write in parallel.
 *
 * What it does NOT protect: races BETWEEN PROCESSES over the same directory (one
 * `cwd` registered in two workspaces, or the app plus an external editor).
 * `temp → rename` protects a single write from being torn, not from a lost
 * update across processes. That gap is not closed here — it is CONSOLIDATED
 * into one place instead of seven.
 */

/** Refused in step 1: the caller declared a state that is no longer on disk. */
export class RecordConflictError extends Error {
  constructor(
    readonly currentHash: string,
    readonly currentContent: string,
  ) {
    super('record changed since last read');
    this.name = 'RecordConflictError';
  }
}

/** Refused in step 1, before serialization: an addressing error, not an authorization one. */
export class RecordPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordPathError';
  }
}

export interface RecordWriteOptions {
  /** The state the caller believes it is writing over. Omitted ⇒ no check. */
  expectedHash?: string;
  /** Who performed the write; feeds M17's `changed_by` through `peekActor`. */
  actor?: WatchActor;
  /** Defaults to `'server'` — this primitive is only ever driven by the app. */
  origin?: WatchOrigin;
}

export interface RecordWriteResult<T> {
  /** Hash of the bytes on disk after the chain settled. */
  hash: string;
  content: string;
  record: T;
  /** Subscription ids whose critical phase failed twice; empty on a clean run. */
  staleProjections: string[];
}

export class RecordStore<T> {
  /** One promise chain per relPath — the tail every new writer awaits. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly opts: {
      readonly registrar: ScopedWatchRegistrar;
      readonly source: string;
      readonly dir: string;
      readonly adapter: RecordFormatAdapter<T>;
      /**
       * Refuse a path before serialization. The source owner supplies its own
       * rule (markdown extensions, `<type>/<slug>.json`, …); the primitive only
       * enforces that the result stays inside `dir`.
       */
      readonly validatePath?: (relPath: string) => void;
    },
  ) {}

  get dir(): string {
    return this.opts.dir;
  }

  get adapter(): RecordFormatAdapter<T> {
    return this.opts.adapter;
  }

  /**
   * Resolve and refuse anything outside the source directory.
   *
   * Step 1, before serialization, and deliberately classified as an ADDRESSING
   * error rather than an authorization one: nobody is being denied access, the
   * path simply does not name a record of this source.
   */
  absFor(relPath: string): string {
    if (!relPath || relPath.includes('\0')) throw new RecordPathError(`invalid path: ${relPath}`);
    this.opts.validatePath?.(relPath);
    const abs = path.resolve(this.opts.dir, relPath);
    const rel = path.relative(this.opts.dir, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new RecordPathError(`path escapes source '${this.opts.source}': ${relPath}`);
    }
    return abs;
  }

  /** The bytes on disk, or null when the file is absent. */
  readRaw(relPath: string): string | null {
    try {
      return fs.readFileSync(this.absFor(relPath), 'utf-8');
    } catch {
      return null;
    }
  }

  read(relPath: string): T | null {
    const raw = this.readRaw(relPath);
    return raw === null ? null : this.opts.adapter.deserialize(raw);
  }

  /** Canonical hash of the state on disk, or null when absent. */
  hashOf(relPath: string): string | null {
    const raw = this.readRaw(relPath);
    return raw === null ? null : this.opts.adapter.hash(raw);
  }

  /**
   * Is this call already inside the chain for THIS very file?
   *
   * A `write-back` writing into the file its own chain is handling must not take
   * the path mutex (the enclosing chain holds it — it would deadlock) and must
   * not start a second chain (it would recurse). It collapses to steps 1–4 and
   * becomes a step inside the run already in progress. This is arm 2 of
   * `suppress`.
   *
   * A write-back to a DIFFERENT file is not this case: it goes the normal route,
   * with its own conflict check, its own commit and its own full chain on its
   * own path.
   */
  private isInOwnChain(relPath: string): boolean {
    const ctx = this.opts.registrar.currentDispatch();
    return ctx !== undefined && ctx.source === this.opts.source && ctx.relPath === relPath;
  }

  /**
   * Steps 1–4: check, serialize, suppress, commit. Synchronous, no chain.
   *
   * Split out because it is also the whole of what an in-chain write-back does,
   * and because the two JSON stores (M29 entities, M17 releases) are synchronous
   * to their callers all the way up.
   */
  private commit(relPath: string, record: T, expectedHash: string | undefined, owner: 'chain' | 'primitive'): string {
    const abs = this.absFor(relPath);

    // 1 — conflict check, over the state on disk, before anything is produced.
    // An ABSENT file is not a conflict: a write doubles as create-or-replace.
    if (expectedHash !== undefined) {
      const raw = this.readRaw(relPath);
      if (raw !== null) {
        const currentHash = this.opts.adapter.hash(raw);
        if (currentHash !== expectedHash) throw new RecordConflictError(currentHash, raw);
      }
    }

    // 2 — the last step that can still fail cleanly. An adapter throwing here
    // leaves the file exactly as it was: no version row, no phase, no trace.
    const bytes = this.opts.adapter.serialize(record);

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // 4 — the token goes up immediately before the write, never earlier.
    this.opts.registrar.suppress(this.opts.source, relPath, owner);
    // 3 — THE COMMIT POINT.
    const tmp = `${abs}.tmp`;
    try {
      fs.writeFileSync(tmp, bytes, 'utf-8');
      fs.renameSync(tmp, abs);
    } catch (err) {
      // The write never landed, so its token has no event of its own to swallow
      // and would eat the next genuine one. Hand it back.
      this.opts.registrar.unsuppress(this.opts.source, relPath);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* the temp file is not worth a second failure */
      }
      throw err;
    }
    return bytes;
  }

  /**
   * The full six steps. Answers with the SETTLED state.
   *
   * The response carries content and not only a hash because the chain may have
   * changed the file after the commit: anchor injection adds lines the caller
   * could not have predicted. A caller holding its pre-injection text would
   * otherwise write it straight back and undo the write-back on every cycle —
   * and a hash alone cannot tell it that.
   */
  async write(relPath: string, record: T, opts: RecordWriteOptions = {}): Promise<RecordWriteResult<T>> {
    if (this.isInOwnChain(relPath)) {
      const bytes = this.commit(relPath, record, opts.expectedHash, 'chain');
      return { hash: this.opts.adapter.hash(bytes), content: bytes, record, staleProjections: [] };
    }
    return await this.withPathLock(relPath, async () => {
      const exists = this.readRaw(relPath) !== null;
      this.commit(relPath, record, opts.expectedHash, 'primitive');
      const chain = await this.runChain(relPath, exists ? 'change' : 'add', opts);
      // 6 — read the settled state, NOT what was handed in. The chain's
      // write-back phase may have rewritten the file after the commit.
      const content = this.readRaw(relPath) ?? '';
      return {
        hash: this.opts.adapter.hash(content),
        content,
        record: this.opts.adapter.deserialize(content),
        staleProjections: chain.staleProjections,
      };
    });
  }

  /** Steps 1–4 only, for callers that are synchronous all the way up. */
  writeSync(relPath: string, record: T, opts: RecordWriteOptions = {}): string {
    const owner = this.isInOwnChain(relPath) ? 'chain' : 'primitive';
    const bytes = this.commit(relPath, record, opts.expectedHash, owner);
    if (owner === 'primitive') this.opts.registrar.releaseSuppress(this.opts.source, relPath);
    return bytes;
  }

  /** Delete a record and run the chain for the unlink. Absent ⇒ nothing to do. */
  async remove(relPath: string, opts: RecordWriteOptions = {}): Promise<boolean> {
    return await this.withPathLock(relPath, async () => {
      if (!this.removeSync(relPath)) return false;
      await this.runChain(relPath, 'unlink', opts);
      return true;
    });
  }

  /** The delete half of {@link writeSync}. */
  removeSync(relPath: string): boolean {
    const abs = this.absFor(relPath);
    this.opts.registrar.suppress(this.opts.source, relPath, 'primitive');
    try {
      fs.unlinkSync(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.opts.registrar.unsuppress(this.opts.source, relPath);
        return false;
      }
      this.opts.registrar.unsuppress(this.opts.source, relPath);
      throw err;
    }
    this.opts.registrar.releaseSuppress(this.opts.source, relPath);
    return true;
  }

  /** Step 5 — the chain, in-band, then the token retired after its guard window. */
  private async runChain(relPath: string, event: WatchEventKind, opts: RecordWriteOptions): Promise<ChainResult> {
    try {
      return await this.opts.registrar.runChain(
        this.opts.source,
        relPath,
        event,
        opts.origin ?? 'server',
        opts.actor,
      );
    } finally {
      this.opts.registrar.releaseSuppress(this.opts.source, relPath);
    }
  }

  /**
   * Serialize writers on one path. Failures do not poison the queue: the next
   * writer runs regardless, which is what makes "the second writer sees what the
   * first left" true even when the first refused.
   */
  private async withPathLock<R>(relPath: string, fn: () => Promise<R>): Promise<R> {
    const prev = this.locks.get(relPath) ?? Promise.resolve();
    // `then(fn, fn)` on purpose: a predecessor that REFUSED still released the
    // path, and the next writer must run — that is what makes "the second writer
    // sees what the first left" true even when the first threw.
    const run = prev.then(fn, fn);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(relPath, settled);
    try {
      return await run;
    } finally {
      // Only the tail clears the entry, so the map cannot grow without bound and
      // a waiter queued in the meantime keeps its predecessor.
      if (this.locks.get(relPath) === settled) this.locks.delete(relPath);
    }
  }
}

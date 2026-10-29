import fs from 'node:fs';
import path from 'node:path';

/**
 * M40 (2.1.60) — the fs event provider of one mount: observes a directory WITH
 * ITS WHOLE SUBTREE and reports `add` / `change` / `unlink` per file.
 *
 * This is the implementation detail the public M40 contract never names
 * (`vfyffo9a`): the observation mechanism of the system, write stabilisation,
 * and the expansion of directory events into file events. Debounce, self-write
 * recognition and dispatch stay in `FileWatchRuntime`.
 *
 * **The cost of a mount does not grow with the number of files.** Where the
 * system offers native recursive observation (macOS FSEvents, Windows), the
 * mount holds ONE stream for its whole subtree. Elsewhere (Linux) it holds one
 * observation per DIRECTORY — Node's own recursive mode there opens a watch per
 * FILE, which is exactly what the specification excludes. Never a resource per
 * file. The in-memory map of known entries is bookkeeping, not a system resource.
 *
 * The three guarantees, whatever the system reports:
 *  - a directory that leaves the subtree (deleted, or moved out of it) yields
 *    one `unlink` per file it held — the provider expands it from what it knew;
 *  - a directory that enters the subtree (created, or moved in with content)
 *    yields one `add` per file in it, and a file created in it later is seen
 *    without remounting (the recursive stream covers it, or the new directory's
 *    own observation is attached before it is listed);
 *  - an event about a file being written is emitted only once the file has
 *    settled: its size and mtime stopped changing for {@link WRITE_SETTLE_MS}.
 *
 * Excluded subtrees are declared by the source's owner at mount time
 * (`exclude`, relative to the mount dir) and dropped here, mechanically, before
 * stabilisation and before the runtime's debounce. An excluded directory is never
 * descended into, so it costs no observation either.
 */

export type DirWatchEvent = 'add' | 'change' | 'unlink';

export interface DirWatchOptions {
  /** Absolute dir of the mount. A dir missing at mount time is observed as empty, silently. */
  dir: string;
  /**
   * The owner's exclusion: true when `relPath` (mount-relative, `/`-separated)
   * lies in, or is the root of, an excluded subtree.
   */
  exclude?: (relPath: string) => boolean;
  onEvent: (event: DirWatchEvent, relPath: string) => void;
  /** A watch failure. Logged by the runtime; never fatal. */
  onError: (err: unknown) => void;
}

/** Systems whose `fs.watch({ recursive: true })` is ONE native stream, not a watch per file. */
const NATIVE_RECURSIVE = process.platform === 'darwin' || process.platform === 'win32';

/**
 * Write stabilisation: a file is reported once its size and mtime have not
 * changed for this long. Re-armed by every sign of life of the file (a raw
 * event, or a size/mtime change seen when the clock fires) — never a fixed
 * deadline.
 */
const WRITE_SETTLE_MS = 100;

type EntryKind = 'file' | 'dir';

interface FileProbe {
  kind: 'file';
  size: number;
  mtimeMs: number;
}

type Probe = FileProbe | { kind: 'dir' } | null;

interface Settling {
  size: number;
  mtimeMs: number;
  timer: NodeJS.Timeout;
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

function parentOf(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

function joinRel(relDir: string, name: string): string {
  const n = name.split(path.sep).join('/');
  return relDir === '' ? n : `${relDir}/${n}`;
}

/**
 * What is at `abs`. A symlink counts when it points at a FILE; a symlinked
 * directory is not followed (a link back to an ancestor would loop the walk).
 */
async function probe(abs: string): Promise<Probe> {
  try {
    let st = await fs.promises.lstat(abs);
    if (st.isSymbolicLink()) {
      st = await fs.promises.stat(abs);
      return st.isFile() ? { kind: 'file', size: st.size, mtimeMs: st.mtimeMs } : null;
    }
    if (st.isDirectory()) return { kind: 'dir' };
    if (st.isFile()) return { kind: 'file', size: st.size, mtimeMs: st.mtimeMs };
    return null;
  } catch {
    return null;
  }
}

export class DirWatch {
  /** Every known entry of the subtree, mount-relative; `''` is the mount dir. */
  private readonly entries = new Map<string, EntryKind>();
  /** Known children of each known dir — what a vanished dir expands into. */
  private readonly children = new Map<string, Set<string>>();
  /** System observations: one (`''`, recursive) or one per directory. */
  private readonly watchers = new Map<string, fs.FSWatcher>();
  /** Files waiting to settle before their event is emitted. */
  private readonly settling = new Map<string, Settling>();
  /** Dirs being listed, and dirs whose listing must run once more (coalescing). */
  private readonly scanning = new Set<string>();
  private readonly rescanDirty = new Set<string>();
  private closed = false;

  constructor(private readonly opts: DirWatchOptions) {
    // The observation goes up BEFORE the first listing, so nothing created in
    // between is lost; the first listing records what exists without emitting.
    if (NATIVE_RECURSIVE && !this.attach('', true)) return;
    void this.scanDir('', false);
  }

  close(): void {
    this.closed = true;
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    for (const s of this.settling.values()) clearTimeout(s.timer);
    this.settling.clear();
    this.entries.clear();
    this.children.clear();
    this.rescanDirty.clear();
  }

  // ------------------------------------------------------------ observation

  private abs(rel: string): string {
    return rel === '' ? this.opts.dir : path.join(this.opts.dir, ...rel.split('/'));
  }

  private excluded(rel: string): boolean {
    return rel !== '' && this.opts.exclude?.(rel) === true;
  }

  /** Observe `relDir` (idempotent). False when the dir is gone or cannot be observed. */
  private attach(relDir: string, recursive: boolean): boolean {
    if (this.watchers.has(relDir)) return true;
    try {
      const w = fs.watch(this.abs(relDir), { recursive }, (_type, name) => this.onRaw(relDir, name));
      w.on('error', (err) => this.onWatcherError(relDir, err));
      this.watchers.set(relDir, w);
      return true;
    } catch (err) {
      const code = errCode(err);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') this.opts.onError(err);
      return false;
    }
  }

  private detach(relDir: string): void {
    const w = this.watchers.get(relDir);
    if (!w) return;
    this.watchers.delete(relDir);
    w.close();
  }

  private onRaw(relDir: string, name: string | Buffer | null): void {
    if (this.closed) return;
    // No name: the system lost track (overflow, coalesced history) — relist.
    if (name === null || name === undefined || String(name) === '') {
      void this.scanDir(relDir, true);
      return;
    }
    const rel = joinRel(relDir, String(name));
    if (this.excluded(rel)) return;
    void this.reconcile(rel);
  }

  private onWatcherError(relDir: string, err: unknown): void {
    if (this.closed) return;
    this.detach(relDir);
    if (relDir === '') {
      this.opts.onError(err);
      return;
    }
    // A per-directory observation fails when its dir is removed — find out.
    void this.reconcile(relDir);
  }

  // ---------------------------------------------------------- reconciliation

  /** Bring one path's bookkeeping in line with the disk, emitting what changed. */
  private async reconcile(rel: string): Promise<void> {
    if (rel === '') {
      await this.scanDir('', true);
      return;
    }
    const p = await probe(this.abs(rel));
    if (this.closed) return;
    const known = this.entries.get(rel);
    if (p?.kind === 'dir') {
      if (known === 'file') this.removeEntry(rel);
      // New dir: walked whole, one `add` per file. Known dir: relisted shallowly.
      await this.scanDir(rel, true);
      return;
    }
    if (known === 'dir') this.removeEntry(rel);
    if (p?.kind === 'file') {
      this.settle(rel, p);
      return;
    }
    this.cancelSettle(rel);
    if (known === 'file') this.removeEntry(rel);
  }

  /**
   * List a dir and reconcile its direct children: new files settle and are
   * added, new dirs are walked whole, vanished children are removed. Known
   * subdirs are not descended into. Concurrent requests for the same dir
   * coalesce into one more pass.
   */
  private async scanDir(rel: string, emit: boolean): Promise<void> {
    if (this.scanning.has(rel)) {
      this.rescanDirty.add(rel);
      return;
    }
    this.scanning.add(rel);
    try {
      let pass = emit;
      do {
        this.rescanDirty.delete(rel);
        await this.scanOnce(rel, pass);
        pass = true;
      } while (this.rescanDirty.has(rel) && !this.closed);
    } finally {
      this.scanning.delete(rel);
    }
  }

  private async scanOnce(rel: string, emit: boolean): Promise<void> {
    if (this.closed) return;
    this.addEntry(rel, 'dir');
    // Per-directory mode: observe the dir BEFORE listing it, so a file created
    // in it right after it appeared is either listed or reported.
    if (!NATIVE_RECURSIVE) this.attach(rel, false);
    let dirents: fs.Dirent[];
    try {
      dirents = await fs.promises.readdir(this.abs(rel), { withFileTypes: true });
    } catch (err) {
      const code = errCode(err);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        this.opts.onError(err);
        return;
      }
      if (rel === '') for (const child of [...(this.children.get('') ?? [])]) this.removeEntry(child);
      else this.removeEntry(rel);
      return;
    }
    if (this.closed || this.entries.get(rel) !== 'dir') return;

    const seen = new Set<string>();
    for (const d of dirents) {
      const child = joinRel(rel, d.name);
      if (this.excluded(child)) continue;
      const known = this.entries.get(child);
      // A regular file already known (or settling) needs no stat: the Dirent
      // gives its kind, and a relist only looks for new or vanished children.
      if (d.isFile() && (known === 'file' || (known !== 'dir' && this.settling.has(child)))) {
        seen.add(child);
        continue;
      }
      let p: Probe;
      if (d.isDirectory()) p = { kind: 'dir' };
      else if (!emit && d.isFile()) p = { kind: 'file', size: -1, mtimeMs: -1 };
      else if (d.isFile() || d.isSymbolicLink()) p = await probe(this.abs(child));
      else p = null;
      if (this.closed) return;
      if (!p) continue;
      seen.add(child);
      if (p.kind === 'dir') {
        if (known === 'file') this.removeEntry(child);
        if (known !== 'dir') await this.scanDir(child, emit);
        continue;
      }
      if (known === 'dir') this.removeEntry(child);
      if (known === 'file' || this.settling.has(child)) continue;
      if (emit) this.settle(child, p);
      else this.addEntry(child, 'file');
    }
    for (const child of [...(this.children.get(rel) ?? [])]) {
      if (!seen.has(child)) void this.reconcile(child);
    }
  }

  // ----------------------------------------------------------- stabilisation

  private settle(rel: string, p: FileProbe): void {
    const prev = this.settling.get(rel);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => void this.settled(rel), WRITE_SETTLE_MS);
    this.settling.set(rel, { size: p.size, mtimeMs: p.mtimeMs, timer });
  }

  private async settled(rel: string): Promise<void> {
    const before = this.settling.get(rel);
    if (!before) return;
    const p = await probe(this.abs(rel));
    // Re-armed by a newer sign of life while we were looking: that clock decides.
    if (this.closed || this.settling.get(rel) !== before) return;
    if (p?.kind !== 'file') {
      this.settling.delete(rel);
      void this.reconcile(rel);
      return;
    }
    if (p.size !== before.size || p.mtimeMs !== before.mtimeMs) {
      this.settle(rel, p);
      return;
    }
    this.settling.delete(rel);
    const event: DirWatchEvent = this.entries.get(rel) === 'file' ? 'change' : 'add';
    this.addEntry(rel, 'file');
    this.opts.onEvent(event, rel);
  }

  private cancelSettle(rel: string): void {
    const s = this.settling.get(rel);
    if (!s) return;
    clearTimeout(s.timer);
    this.settling.delete(rel);
  }

  // ------------------------------------------------------------- bookkeeping

  private addEntry(rel: string, kind: EntryKind): void {
    if (this.entries.get(rel) === kind) return;
    this.entries.set(rel, kind);
    if (kind === 'dir' && !this.children.has(rel)) this.children.set(rel, new Set());
    if (rel === '') return;
    const parent = parentOf(rel);
    if (this.entries.get(parent) !== 'dir') {
      if (this.entries.has(parent)) this.removeEntry(parent);
      this.addEntry(parent, 'dir');
    }
    this.children.get(parent)!.add(rel);
  }

  /** Forget an entry; a file emits `unlink`, a dir expands into one per file it held. */
  private removeEntry(rel: string): void {
    const kind = this.entries.get(rel);
    if (kind === undefined) return;
    this.entries.delete(rel);
    if (rel !== '') this.children.get(parentOf(rel))?.delete(rel);
    if (kind === 'file') {
      this.cancelSettle(rel);
      this.opts.onEvent('unlink', rel);
      return;
    }
    const kids = this.children.get(rel);
    this.children.delete(rel);
    for (const kid of kids ?? []) this.removeEntry(kid);
    this.detach(rel);
    // Files under it still settling were never reported — nothing to unlink.
    const prefix = `${rel}/`;
    for (const [p, s] of this.settling) {
      if (!p.startsWith(prefix)) continue;
      clearTimeout(s.timer);
      this.settling.delete(p);
    }
  }
}

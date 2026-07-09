import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { makeWatchIgnore } from './watch-ignore.js';

type EventKind = 'add' | 'change' | 'unlink';

export type ReleasesWatcherCallback = (relPath: string, kind: EventKind) => void;

/**
 * 0.1.118: dedicated chokidar watcher for the on-disk release-identity store
 * (`<releasesDir>/<slug>.json`), mirroring `EntitiesWatcher` (M29). Flat —
 * no type subfolders, unlike entities. Does NOT broadcast on its own — the
 * `ReleaseIndexerService` owns any downstream signal, emitted only after a
 * successful reindex.
 *
 * Rooted directly AT `<releasesDir>` so chokidar's leading-dot ignore (the
 * `.claude4spec/` segment) never excludes its own contents.
 */
export class ReleasesWatcher {
  private watcher: FSWatcher | null = null;
  private suppressUntil = new Map<string, number>();
  private readonly SUPPRESS_WINDOW_MS = 500;
  private callbacks: ReleasesWatcherCallback[] = [];

  constructor(private releasesRoot: string) {}

  onChange(cb: ReleasesWatcherCallback): void {
    this.callbacks.push(cb);
  }

  start(): void {
    this.watcher = chokidar.watch(this.releasesRoot, {
      ignoreInitial: true,
      ignored: makeWatchIgnore(this.releasesRoot),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    });
    this.watcher.on('add', (p) => this.emit('add', p));
    this.watcher.on('change', (p) => this.emit('change', p));
    this.watcher.on('unlink', (p) => this.emit('unlink', p));
    this.watcher.on('error', (err) => console.error('[releases-watcher] watch error:', err));
  }

  /** Call before a programmatic write so the resulting chokidar event is suppressed. */
  suppress(relPath: string): void {
    this.suppressUntil.set(relPath, Date.now() + this.SUPPRESS_WINDOW_MS);
  }

  private emit(kind: EventKind, absPath: string): void {
    if (!absPath.endsWith('.json')) return;
    const relPath = path.relative(this.releasesRoot, absPath).replaceAll(path.sep, '/');
    const suppressedUntil = this.suppressUntil.get(relPath);
    if (suppressedUntil && Date.now() < suppressedUntil) {
      this.suppressUntil.delete(relPath);
      return;
    }
    for (const cb of this.callbacks) {
      try {
        cb(relPath, kind);
      } catch (err) {
        console.error('[releases-watcher] callback error:', err);
      }
    }
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}

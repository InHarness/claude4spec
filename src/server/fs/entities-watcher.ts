import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { makeWatchIgnore } from './watch-ignore.js';

type EventKind = 'add' | 'change' | 'unlink';

export type EntitiesWatcherCallback = (relPath: string, kind: EventKind) => void;

/**
 * M29: dedicated chokidar watcher for the committed entity store
 * (`<entitiesDir>/<type>/<slug>.json` + `tags.json`). A sibling of
 * `PagesWatcher` rather than a reuse because it differs in two load-bearing
 * ways:
 *   - it watches `.json` (PagesWatcher hard-filters `.md`),
 *   - it does NOT broadcast on its own — the `EntityIndexerService` owns the WS
 *     `entity:indexed` event, emitted only after a successful reindex.
 *
 * Rooted directly AT `<entitiesDir>` so chokidar's leading-dot ignore (the
 * `.claude4spec/` segment) never excludes its own contents. The 3 page-family
 * watchers (pages/briefs/patches) are rooted outside `.claude4spec/`, so they
 * never traverse the entity store — this watcher owns it exclusively.
 */
export class EntitiesWatcher {
  private watcher: FSWatcher | null = null;
  private suppressUntil = new Map<string, number>();
  private readonly SUPPRESS_WINDOW_MS = 500;
  private callbacks: EntitiesWatcherCallback[] = [];

  constructor(private entitiesRoot: string) {}

  onChange(cb: EntitiesWatcherCallback): void {
    this.callbacks.push(cb);
  }

  start(): void {
    this.watcher = chokidar.watch(this.entitiesRoot, {
      ignoreInitial: true,
      // Ignore editor/dotfiles (e.g. `.foo.json.swp`, `.DS_Store`) and heavy
      // dirs. Entity files are `<type>/<slug>.json` / `tags.json` — never
      // dot-prefixed basenames.
      ignored: makeWatchIgnore(this.entitiesRoot),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    });
    this.watcher.on('add', (p) => this.emit('add', p));
    this.watcher.on('change', (p) => this.emit('change', p));
    this.watcher.on('unlink', (p) => this.emit('unlink', p));
    // Keep watch errors (EMFILE etc.) non-fatal — an unhandled 'error' event
    // would otherwise crash the process.
    this.watcher.on('error', (err) => console.error('[entities-watcher] watch error:', err));
  }

  /** Call before a programmatic write so the resulting chokidar event is suppressed. */
  suppress(relPath: string): void {
    this.suppressUntil.set(relPath, Date.now() + this.SUPPRESS_WINDOW_MS);
  }

  private emit(kind: EventKind, absPath: string): void {
    if (!absPath.endsWith('.json')) return;
    const relPath = path.relative(this.entitiesRoot, absPath).replaceAll(path.sep, '/');
    const suppressedUntil = this.suppressUntil.get(relPath);
    if (suppressedUntil && Date.now() < suppressedUntil) {
      this.suppressUntil.delete(relPath);
      return;
    }
    for (const cb of this.callbacks) {
      try {
        cb(relPath, kind);
      } catch (err) {
        console.error('[entities-watcher] callback error:', err);
      }
    }
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}

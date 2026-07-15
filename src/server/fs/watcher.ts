import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import type { WsEmitter } from '../ws/project-emitter.js';
import { isMarkdownPath } from '../../shared/page-files.js';
import { makeWatchIgnore } from './watch-ignore.js';

type EventKind = 'add' | 'change' | 'unlink';

export type PagesWatcherCallback = (relPath: string, kind: EventKind) => void;

export class PagesWatcher {
  private watcher: FSWatcher | null = null;
  private suppressUntil = new Map<string, number>();
  private readonly SUPPRESS_WINDOW_MS = 350;
  private callbacks: PagesWatcherCallback[] = [];

  constructor(
    private pagesRoot: string,
    private gateway: WsEmitter,
    /** 0.1.96: which root these events belong to ('pages' | user slug | 'brief' | 'patch'). */
    readonly rootId: string = 'pages',
  ) {}

  onChange(cb: PagesWatcherCallback): void {
    this.callbacks.push(cb);
  }

  start(): void {
    this.watcher = chokidar.watch(this.pagesRoot, {
      ignoreInitial: true,
      ignored: makeWatchIgnore(this.pagesRoot),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    });
    this.watcher.on('add', (p) => this.emit('add', p));
    this.watcher.on('change', (p) => this.emit('change', p));
    this.watcher.on('unlink', (p) => this.emit('unlink', p));
    // EMFILE (and other watch errors) emit on the 'error' event — without a
    // listener Node escalates them to an uncaught exception that kills the
    // process. Log instead so a transient watch failure stays non-fatal.
    this.watcher.on('error', (err) => console.error('[watcher] watch error:', err));
  }

  /** Call before a programmatic write so the resulting chokidar event is suppressed. */
  suppress(relPath: string): void {
    this.suppressUntil.set(relPath, Date.now() + this.SUPPRESS_WINDOW_MS);
  }

  /**
   * Broadcast a server-origin change event for a programmatic write.
   * Clients receive `file:changed { origin: 'server' }` and should silently reload
   * without showing the "file changed externally" dialog.
   * Does NOT fire the callback chain (callbacks are for external-origin indexing).
   */
  emitServerWrite(relPath: string): void {
    this.gateway.broadcast({ kind: 'file:changed', event: 'change', path: relPath, rootId: this.rootId, origin: 'server' });
  }

  private emit(kind: EventKind, absPath: string): void {
    const isMd = isMarkdownPath(absPath);
    // M30: watch .html too (so the preview iframe can refresh), but only markdown
    // (.md / .mdx) drives indexing.
    const isHtml = absPath.endsWith('.html');
    if (!isMd && !isHtml) return;
    const relPath = path.relative(this.pagesRoot, absPath).replaceAll(path.sep, '/');
    const suppressedUntil = this.suppressUntil.get(relPath);
    if (suppressedUntil && Date.now() < suppressedUntil) {
      this.suppressUntil.delete(relPath);
      return;
    }
    this.gateway.broadcast({ kind: 'file:changed', event: kind, path: relPath, rootId: this.rootId, origin: 'external' });
    // Indexer callbacks (M06 section index) run for .md only — .html is never indexed/versioned.
    if (!isMd) return;
    for (const cb of this.callbacks) {
      try {
        cb(relPath, kind);
      } catch (err) {
        console.error('[watcher] callback error:', err);
      }
    }
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}

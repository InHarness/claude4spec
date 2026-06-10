import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import type { WsEmitter } from '../ws/project-emitter.js';

type EventKind = 'add' | 'change' | 'unlink';

export type PagesWatcherCallback = (relPath: string, kind: EventKind) => void;

export class PagesWatcher {
  private watcher: FSWatcher | null = null;
  private suppressUntil = new Map<string, number>();
  private readonly SUPPRESS_WINDOW_MS = 350;
  private callbacks: PagesWatcherCallback[] = [];

  constructor(private pagesRoot: string, private gateway: WsEmitter) {}

  onChange(cb: PagesWatcherCallback): void {
    this.callbacks.push(cb);
  }

  start(): void {
    this.watcher = chokidar.watch(this.pagesRoot, {
      ignoreInitial: true,
      ignored: (p) => /(^|\/|\\)\./.test(path.basename(p)),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    });
    this.watcher.on('add', (p) => this.emit('add', p));
    this.watcher.on('change', (p) => this.emit('change', p));
    this.watcher.on('unlink', (p) => this.emit('unlink', p));
  }

  /** Call before a programmatic write so the resulting chokidar event is suppressed. */
  suppress(relPath: string): void {
    this.suppressUntil.set(relPath, Date.now() + this.SUPPRESS_WINDOW_MS);
  }

  /**
   * Broadcast a server-origin change event for a programmatic write.
   * Clients receive `page:changed { origin: 'server' }` and should silently reload
   * without showing the "file changed externally" dialog.
   * Does NOT fire the callback chain (callbacks are for external-origin indexing).
   */
  emitServerWrite(relPath: string): void {
    this.gateway.broadcast({ kind: 'page:changed', event: 'change', path: relPath, origin: 'server' });
  }

  private emit(kind: EventKind, absPath: string): void {
    const isMd = absPath.endsWith('.md');
    // M30: watch .html too (so the preview iframe can refresh), but only .md drives indexing.
    const isHtml = absPath.endsWith('.html');
    if (!isMd && !isHtml) return;
    const relPath = path.relative(this.pagesRoot, absPath).replaceAll(path.sep, '/');
    const suppressedUntil = this.suppressUntil.get(relPath);
    if (suppressedUntil && Date.now() < suppressedUntil) {
      this.suppressUntil.delete(relPath);
      return;
    }
    this.gateway.broadcast({ kind: 'page:changed', event: kind, path: relPath, origin: 'external' });
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

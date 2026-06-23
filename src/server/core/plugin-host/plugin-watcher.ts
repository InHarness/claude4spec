/**
 * M33 phase 3 — plugin-pool hot-reload watcher.
 *
 * The main `PagesWatcher` is rooted OUTSIDE `.claude4spec/`, so plugin sources
 * are watched by this dedicated watcher instead. It is the *mechanism only* —
 * the reload pipeline (cache-bust import → onUnregister old → register new →
 * invalidate ProjectContext → broadcast) is supplied by the caller via
 * `onReload`. There is deliberately no projection store (no `byPath` map, no
 * SQLite): the live `PluginRegistry` (base) + `ProjectPluginOverlay` (overlay)
 * ARE the index (divergence from M29 — only the watcher is reused).
 *
 * Two callers wire it differently:
 *   - overlay: one watcher per `ProjectContext` over `<cwd>/.claude4spec/plugins/`,
 *     mounted only behind the `trustProjectPlugins` gate; closed on dispose.
 *   - base: one process-global watcher over the resolved workspace package dirs.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';

export type PluginWatcherCallback = (changedPaths: string[]) => void;

const DEFAULT_DEBOUNCE_MS = 300;
const SUPPRESS_WINDOW_MS = 600;

export class PluginWatcher {
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Set<string>();
  private suppressUntil = new Map<string, number>();

  /**
   * @param roots   absolute directories to watch (empty ⇒ `start()` is a no-op).
   * @param onReload invoked (debounced) with the de-duplicated changed paths.
   */
  constructor(
    private readonly roots: string[],
    private readonly onReload: PluginWatcherCallback,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  start(): void {
    if (this.roots.length === 0 || this.watcher) return;
    this.watcher = chokidar.watch(this.roots, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    });
    const onEvent = (p: string) => this.queue(p);
    this.watcher.on('add', onEvent);
    this.watcher.on('change', onEvent);
    this.watcher.on('unlink', onEvent);
    this.watcher.on('addDir', onEvent);
    this.watcher.on('unlinkDir', onEvent);
  }

  /**
   * Call BEFORE a reload-initiated write into a watched dir so the resulting
   * chokidar event does not re-trigger the pipeline (reload → write → reload).
   * Keyed by absolute path.
   */
  suppress(absPath: string): void {
    this.suppressUntil.set(path.resolve(absPath), Date.now() + SUPPRESS_WINDOW_MS);
  }

  private queue(absPath: string): void {
    const resolved = path.resolve(absPath);
    const until = this.suppressUntil.get(resolved);
    if (until && Date.now() < until) {
      this.suppressUntil.delete(resolved);
      return;
    }
    this.pending.add(resolved);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush(): void {
    this.timer = null;
    if (this.pending.size === 0) return;
    const paths = [...this.pending];
    this.pending.clear();
    try {
      this.onReload(paths);
    } catch (err) {
      console.warn('[plugin-watcher] onReload threw:', (err as Error).message);
    }
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    await this.watcher?.close();
    this.watcher = null;
  }
}

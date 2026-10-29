import type { WsEvent } from '../../../shared/types.js';
import { reloadPlugin, type PluginImporter, type PluginLoadRecord } from './loader.js';
import type { PluginRegistry } from './types.js';

export type PluginReloadedEvent = Extract<WsEvent, { kind: 'plugin:reloaded' }>;

export interface BaseReloadDeps {
  /** The process-global registry the base tier is registered in. */
  pluginRegistry: PluginRegistry;
  /**
   * The base load records — kept current: the frontend manifest announces only
   * packages whose backend is `loaded` (2.1.20).
   */
  records: PluginLoadRecord[];
  /** The base locator's resolution — the same one the bootstrap import used. */
  resolveEntry: (pkg: string) => string | null;
  importer?: PluginImporter;
  cacheBust?: (entry: string) => string;
  /** Step 4: invalidates every project's context (M31 `invalidateAll`). */
  invalidateAll: () => void;
  /** Step 5: `plugin:reloaded` to the room of every project of the process. */
  broadcast: (event: PluginReloadedEvent) => void;
}

/**
 * M33 L7 `m33l7pln` — the reload pipeline for one burst of changes in
 * `plugins:base` (after the mount's debounce): per package cache-bust import,
 * unregister the old version, register the new (`reloadPlugin`, steps 1–3);
 * then ONE invalidation of every project's context (step 4) — the base pool is
 * shared, so every context depends on it, and each is rebuilt at once, in the
 * order of the M31 queue (2.1.60) — and the `plugin:reloaded` broadcast
 * (step 5).
 *
 * A package whose new version is skipped (import failure, invalid manifest,
 * incompatible host API) keeps its old version, so it changes nothing: when no
 * package of the burst loaded, the effective pool is the same and no context
 * is invalidated or told to remount.
 */
export async function reloadBasePackages(deps: BaseReloadDeps, packages: readonly string[]): Promise<void> {
  const reloaded: PluginReloadedEvent[] = [];
  for (const pkg of packages) {
    const rec = await reloadPlugin(deps.pluginRegistry, pkg, {
      resolveEntry: deps.resolveEntry,
      importer: deps.importer,
      cacheBust: deps.cacheBust,
    });
    if (rec.status !== 'loaded') continue;
    const i = deps.records.findIndex((r) => r.package === pkg);
    if (i >= 0) deps.records[i] = { ...deps.records[i], ...rec };
    else deps.records.push(rec);
    reloaded.push({ kind: 'plugin:reloaded', name: rec.manifestName ?? pkg, version: rec.manifestVersion ?? '', tier: 'base' });
  }
  if (reloaded.length === 0) return;
  deps.invalidateAll();
  for (const event of reloaded) deps.broadcast(event);
}

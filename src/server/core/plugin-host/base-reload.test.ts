/**
 * 2.1.60 — M33 L7 `m33l7pln` step 4: a change in `plugins:base` invalidates the
 * contexts of ALL projects, and the order of their rebuild is the M31 queue's
 * (`m31ctx001`). The pipeline (`reloadBasePackages`, wired by `startServer`
 * after the mount's burst debounce) runs against the REAL context cache; the
 * contexts are stand-ins whose build records the order, and the package import
 * is a seam (no filesystem, no module resolver).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadBasePackages, type PluginReloadedEvent } from './base-reload.js';
import { PluginRegistryImpl } from './registry.js';
import type { PluginLoadRecord } from './loader.js';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';
import { ProjectContextCache } from '../../workspace/context-cache.js';
import type { ProjectContext } from '../../workspace/project-context.js';
import type { ProjectRecord } from '../../workspace/types.js';

const PKG = '@c4s-fixture/base-plugin';

function manifest(version: string): PluginManifest {
  return {
    name: PKG,
    version,
    hostApiVersion: '^2.0.0',
    contributes: {
      commands: [{ name: 'base-insert', trigger: 'base', label: 'Insert base', popoverKind: 'base' }],
    },
  } as PluginManifest;
}

const projects: ProjectRecord[] = ['a', 'b', 'c'].map((id) => ({ id, cwd: `/tmp/${id}` }) as ProjectRecord);

let cache: ProjectContextCache | undefined;

afterEach(async () => {
  await cache?.disposeAll();
  cache = undefined;
  vi.restoreAllMocks();
});

/** A cache whose every build is recorded (project id, in build order) and whose disposals are recorded. */
function recordingCache() {
  const builds: string[] = [];
  const disposed: ProjectContext[] = [];
  const c = new ProjectContextCache(async (p) => {
    builds.push(p.id);
    const ctx = {
      projectId: p.id,
      hasInFlightTurn: () => false,
      dispose: async () => {
        disposed.push(ctx);
      },
    } as unknown as ProjectContext;
    return ctx;
  });
  return { cache: c, builds, disposed };
}

describe('M33 L7 — the base reload pipeline (m33l7pln)', () => {
  it('[section:m33l7pln] a change in plugins:base re-registers the package, invalidates the contexts of ALL projects — each rebuilt at once, in the M31 queue order — then broadcasts plugin:reloaded', async () => {
    const rec = recordingCache();
    cache = rec.cache;
    // The start: `c` is the last opened project, so it builds first; the
    // workspace's composition order is a, b, c.
    cache.start(projects, 'c');
    await vi.waitFor(() => expect(projects.every((p) => cache!.getLive(p.id) !== null)).toBe(true));
    expect(rec.builds).toEqual(['c', 'a', 'b']);
    const before = projects.map((p) => cache!.getLive(p.id)!);

    const pluginRegistry = new PluginRegistryImpl();
    pluginRegistry.registerPlugin(manifest('1.0.0'));
    const records: PluginLoadRecord[] = [{ package: PKG, status: 'loaded', layer: 'base', manifestVersion: '1.0.0' }];
    const order: string[] = [];
    const events: PluginReloadedEvent[] = [];

    await reloadBasePackages(
      {
        pluginRegistry,
        records,
        resolveEntry: () => '/fake/dist/index.js',
        importer: async () => ({ manifest: manifest('2.0.0') }),
        cacheBust: () => '?v=2',
        invalidateAll: () => {
          order.push('invalidate');
          cache!.invalidateAll();
        },
        broadcast: (event) => {
          order.push('broadcast');
          events.push(event);
        },
      },
      [PKG],
    );

    // Steps 1–3: the new version is registered, the base record kept current.
    expect(pluginRegistry.listPluginRecords().map((r) => r.version)).toEqual(['2.0.0']);
    expect(records[0]).toMatchObject({ package: PKG, status: 'loaded', manifestVersion: '2.0.0' });
    // Step 4 before step 5: ONE invalidation, then the broadcast.
    expect(order).toEqual(['invalidate', 'broadcast']);
    expect(events).toEqual([{ kind: 'plugin:reloaded', name: PKG, version: '2.0.0', tier: 'base' }]);

    // Every project is rebuilt without any request, in the composition order
    // (the queue's «invalidated» level) — not in the start order.
    await vi.waitFor(() => expect(rec.builds).toHaveLength(6));
    expect(rec.builds.slice(3)).toEqual(['a', 'b', 'c']);
    await vi.waitFor(() => expect(projects.every((p) => cache!.getLive(p.id) !== null)).toBe(true));
    projects.forEach((p, i) => expect(cache!.getLive(p.id)).not.toBe(before[i]));
    // The predecessors (no turn in flight) are released.
    await vi.waitFor(() => expect(rec.disposed).toHaveLength(3));
    expect(new Set(rec.disposed)).toEqual(new Set(before));
  });

  it('[section:m33l7pln] a new version that is skipped keeps the old one: no context is invalidated and nothing is broadcast', async () => {
    const rec = recordingCache();
    cache = rec.cache;
    cache.start(projects);
    await vi.waitFor(() => expect(projects.every((p) => cache!.getLive(p.id) !== null)).toBe(true));
    const before = projects.map((p) => cache!.getLive(p.id)!);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pluginRegistry = new PluginRegistryImpl();
    pluginRegistry.registerPlugin(manifest('1.0.0'));
    const records: PluginLoadRecord[] = [{ package: PKG, status: 'loaded', layer: 'base', manifestVersion: '1.0.0' }];
    const invalidateAll = vi.fn(() => cache!.invalidateAll());
    const broadcast = vi.fn();

    await reloadBasePackages(
      {
        pluginRegistry,
        records,
        resolveEntry: () => '/fake/dist/index.js',
        importer: async () => {
          throw new Error('half-written build');
        },
        cacheBust: () => '?v=broken',
        invalidateAll,
        broadcast,
      },
      [PKG],
    );

    expect(pluginRegistry.listPluginRecords().map((r) => r.version)).toEqual(['1.0.0']);
    expect(records[0]).toMatchObject({ status: 'loaded', manifestVersion: '1.0.0' });
    expect(invalidateAll).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    projects.forEach((p, i) => expect(cache!.getLive(p.id)).toBe(before[i]));
    expect(rec.builds).toHaveLength(3);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectContextCache } from './context-cache.js';
import type { ProjectContext } from './project-context.js';
import type { ProjectRecord } from './types.js';

function fakeCtx(id: string, inFlight = () => false) {
  return {
    projectId: id,
    hasInFlightTurn: inFlight,
    dispose: vi.fn(async () => {}),
  } as unknown as ProjectContext & { dispose: ReturnType<typeof vi.fn> };
}

function setup(maxLive: number) {
  const built: string[] = [];
  const ctxs = new Map<string, ReturnType<typeof fakeCtx>>();
  const cache = new ProjectContextCache(async (p) => {
    built.push(p.id);
    const ctx = fakeCtx(p.id);
    ctxs.set(p.id, ctx);
    return ctx;
  }, maxLive);
  const project = (id: string) => ({ id }) as ProjectRecord;
  return { cache, built, ctxs, project };
}

describe('ProjectContextCache — LRU budget', () => {
  // LRU order comes from Date.now(); a monotonic clock keeps same-millisecond
  // gets from tying.
  beforeEach(() => {
    let t = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => ++t);
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps exactly maxLive contexts live when a turn finishes (no eviction at the budget)', async () => {
    const { cache, built, project } = setup(3);
    for (const id of ['a', 'b', 'c']) await cache.get(project(id));

    cache.reapIdle();

    expect(['a', 'b', 'c'].every((id) => cache.isLive(id))).toBe(true);
    await cache.get(project('a'));
    expect(built).toEqual(['a', 'b', 'c']);
  });

  it('evicts the least-recently-used context to make room for a new build', async () => {
    const { cache, ctxs, project } = setup(3);
    for (const id of ['a', 'b', 'c']) await cache.get(project(id));
    await cache.get(project('a')); // b is now LRU

    await cache.get(project('d'));

    expect(cache.isLive('b')).toBe(false);
    expect(ctxs.get('b')!.dispose).toHaveBeenCalledTimes(1);
    expect(['a', 'c', 'd'].every((id) => cache.isLive(id))).toBe(true);
  });

  it('reapIdle trims back to maxLive once an over-budget active project goes idle', async () => {
    const busy = new Set(['a', 'b']);
    const cache = new ProjectContextCache(async (p) => fakeCtx(p.id, () => busy.has(p.id)), 2);
    const project = (id: string) => ({ id }) as ProjectRecord;
    await cache.get(project('a'));
    await cache.get(project('b'));
    await cache.get(project('c')); // a and b in flight — budget exceeded instead
    expect(['a', 'b', 'c'].every((id) => cache.isLive(id))).toBe(true);

    busy.clear();
    cache.reapIdle();

    expect(cache.isLive('a')).toBe(false); // LRU goes first
    expect(['b', 'c'].every((id) => cache.isLive(id))).toBe(true);
  });
});

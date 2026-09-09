import { describe, expect, it, vi } from 'vitest';
import { PROJECTION_IDS, ProjectionStatusRegistry } from './projection-status.js';
import { isDiscoveryError } from '../discovery/errors.js';
import type { WsEvent } from '../../shared/types.js';

function rig() {
  const events: WsEvent[] = [];
  const reg = new ProjectionStatusRegistry({ broadcast: (e) => void events.push(e) });
  return { reg, events };
}

describe('0.2.77 — projection staleness as a first-class state', () => {
  it('starts every projection as not_materialized, which is not the same as stale', () => {
    const { reg } = rig();
    const rows = reg.snapshot();
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.state === 'not_materialized')).toBe(true);
    // The two are different answers to different questions, and nothing may
    // collapse them: "never built" sends the caller somewhere else than
    // "built and out of date".
    expect(rows.every((r) => r.scope === undefined)).toBe(true);
    expect(rows.every((r) => r.lastRebuiltAt === null)).toBe(true);
  });

  it('[ac:ac-oznaczenie-nieswiezosci-indeksu-sekcj] marks the section index per page, leaving the rest of the root usable', () => {
    const { reg } = rig();
    reg.markFresh(PROJECTION_IDS.sections);
    reg.markStale(PROJECTION_IDS.sections, 'pages:a.md');

    expect(reg.isStale(PROJECTION_IDS.sections, 'pages:a.md')).toBe(true);
    // Every other page of the same root is untouched — the marking is an
    // artifact-level fact, not a projection-level one.
    expect(reg.isStale(PROJECTION_IDS.sections, 'pages:b.md')).toBe(false);
    expect(reg.snapshot().find((r) => r.id === PROJECTION_IDS.sections)?.scope).toEqual(['pages:a.md']);
  });

  it('poisons every backref read from ONE marked source page (M14 only)', () => {
    const { reg } = rig();
    reg.markFresh(PROJECTION_IDS.pageLinks);
    reg.markStale(PROJECTION_IDS.pageLinks, 'pages:a.md');

    /**
     * The one projection where a LOCAL marking refuses GLOBALLY. `reverseIndex`
     * aggregates over every source page, so one source that did not recompute
     * makes the backref answer wrong for every TARGET — the refusal is decided
     * by the existence of a marker, not by what was asked about.
     */
    expect(reg.isStale(PROJECTION_IDS.pageLinks, 'pages:completely-other.md')).toBe(true);
    // Contrast: the section index does not work this way.
    reg.markFresh(PROJECTION_IDS.sections);
    reg.markStale(PROJECTION_IDS.sections, 'pages:a.md');
    expect(reg.isStale(PROJECTION_IDS.sections, 'pages:completely-other.md')).toBe(false);
  });

  it('refuses with INDEX_STALE carrying the scope and a rebuild path', () => {
    const { reg } = rig();
    reg.markStale(PROJECTION_IDS.entities, 'ac');
    try {
      reg.assertFresh(PROJECTION_IDS.entities, 'ac');
      expect.unreachable('should have refused');
    } catch (err) {
      expect(isDiscoveryError(err)).toBe(true);
      if (!isDiscoveryError(err)) return;
      expect(err.code).toBe('INDEX_STALE');
      // The message says what was marked, the hint says how to get out. A
      // refusal with no way out is a dead end.
      expect(err.message).toContain('ac');
      expect(err.hint).toContain('rebuild');
      expect(err.hint).toContain('get_page');
    }
  });

  it('a global marking supersedes accumulated local ones rather than joining them', () => {
    const { reg } = rig();
    reg.markStale(PROJECTION_IDS.sections, 'pages:a.md');
    reg.markStale(PROJECTION_IDS.sections);
    // Listing the pages noticed first would imply the others are fine.
    expect(reg.snapshot().find((r) => r.id === PROJECTION_IDS.sections)?.scope).toBe('global');
    expect(reg.isStale(PROJECTION_IDS.sections, 'pages:anything.md')).toBe(true);
  });

  it('returns to fresh only when the LAST marked artifact clears', () => {
    const { reg } = rig();
    reg.markStale(PROJECTION_IDS.sections, 'pages:a.md');
    reg.markStale(PROJECTION_IDS.sections, 'pages:b.md');
    reg.markFresh(PROJECTION_IDS.sections, 'pages:a.md');
    expect(reg.snapshot().find((r) => r.id === PROJECTION_IDS.sections)?.state).toBe('stale');
    reg.markFresh(PROJECTION_IDS.sections, 'pages:b.md');
    expect(reg.snapshot().find((r) => r.id === PROJECTION_IDS.sections)?.state).toBe('fresh');
  });

  it('announces every transition in BOTH directions', () => {
    const { reg, events } = rig();
    reg.markStale(PROJECTION_IDS.releases);
    reg.markFresh(PROJECTION_IDS.releases);
    // A client that only ever hears about failure has no way to take the banner
    // down, and would have to poll to find out. Nothing here polls.
    expect(events.map((e) => (e as { state: string }).state)).toEqual(['stale', 'fresh']);
    expect(events[0]).toMatchObject({ kind: 'index:status-changed', projection: PROJECTION_IDS.releases, scope: 'global' });
  });

  it('a second rebuild request JOINS the pass in flight instead of starting another', async () => {
    const { reg } = rig();
    let running = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const rebuild = vi.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await gate;
      running -= 1;
    });
    reg.registerRebuild(PROJECTION_IDS.entities, rebuild);

    const a = reg.rebuild(PROJECTION_IDS.entities);
    const b = reg.rebuild(PROJECTION_IDS.entities);
    release();
    await Promise.all([a, b]);

    // Two concurrent full rebuilds of one projection would race each other's
    // writes for no benefit whatsoever.
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);
  });

  it('moves lastRebuiltAt only on SUCCESS — which is what tells a second failure from a failed action', async () => {
    const { reg } = rig();
    let ok = false;
    reg.registerRebuild(PROJECTION_IDS.entities, async () => {
      if (!ok) throw new Error('nope');
    });

    await expect(reg.rebuild(PROJECTION_IDS.entities)).rejects.toThrow('nope');
    expect(reg.snapshot().find((r) => r.id === PROJECTION_IDS.entities)?.lastRebuiltAt).toBeNull();

    ok = true;
    await reg.rebuild(PROJECTION_IDS.entities);
    const after = reg.snapshot().find((r) => r.id === PROJECTION_IDS.entities)!.lastRebuiltAt;
    expect(after).not.toBeNull();

    /**
     * A projection that goes stale again immediately after a successful rebuild
     * is a SECOND, separate failure — not a failed action. The moved timestamp
     * is the only thing that tells the two apart, so it must survive the
     * re-marking.
     */
    reg.markStale(PROJECTION_IDS.entities);
    expect(reg.snapshot().find((r) => r.id === PROJECTION_IDS.entities)?.lastRebuiltAt).toBe(after);
  });

  it('is idempotent and allowed on a projection that is already fresh', async () => {
    const { reg } = rig();
    const rebuild = vi.fn(async () => {});
    reg.registerRebuild(PROJECTION_IDS.todos, rebuild);
    await reg.rebuild(PROJECTION_IDS.todos);
    // A button that refused when everything looked fine could not be used to
    // check whether everything is in fact fine.
    await reg.rebuild(PROJECTION_IDS.todos);
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it('a rebuild keeps what it marked ITSELF, and clears only what predates the pass', async () => {
    const { reg } = rig();
    // The shape `EntityIndexerService.indexAll` has: the pass succeeds, and
    // reports from inside that one declared type has no table to read.
    reg.registerRebuild(PROJECTION_IDS.entities, async () => {
      reg.markStale(PROJECTION_IDS.entities, 'ghost');
    });
    reg.markStale(PROJECTION_IDS.entities, 'widget');

    await reg.rebuild(PROJECTION_IDS.entities);

    const row = reg.snapshot().find((r) => r.id === PROJECTION_IDS.entities)!;
    // `widget` is what the pass was for; `ghost` is what it just disproved.
    // Reporting the projection fresh here would hand `list_entities({type:'ghost'})`
    // back out of a table that was never filled.
    expect(row.state).toBe('stale');
    expect(row.scope).toEqual(['ghost']);
    expect(reg.isStale(PROJECTION_IDS.entities, 'widget')).toBe(false);
    expect(row.lastRebuiltAt).toBeNull();
  });

  it('a rebuild does not swallow a failure that arrived while it was running', async () => {
    const { reg } = rig();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    reg.registerRebuild(PROJECTION_IDS.sections, () => gate);
    reg.markFresh(PROJECTION_IDS.sections);

    const pass = reg.rebuild(PROJECTION_IDS.sections);
    // A watcher reaction fails on a page the pass had already walked past.
    reg.markStale(PROJECTION_IDS.sections, 'pages:c.md');
    release();
    await pass;

    expect(reg.isStale(PROJECTION_IDS.sections, 'pages:c.md')).toBe(true);
  });

  it('one artifact recomputing does not lift a GLOBAL marking', () => {
    const { reg } = rig();
    reg.markStale(PROJECTION_IDS.sections);
    reg.markFresh(PROJECTION_IDS.sections, 'pages:a.md');
    // Global says the whole projection is unusable — usually because the index
    // is empty or half-built. One page succeeding is no evidence against that,
    // and treating it as such would declare health nobody established.
    expect(reg.isGloballyStale(PROJECTION_IDS.sections)).toBe(true);
    expect(reg.snapshot().find((r) => r.id === PROJECTION_IDS.sections)?.lastRebuiltAt).toBeNull();
  });

  it('separates the whole-projection question from the per-artifact one', () => {
    const { reg } = rig();
    reg.markStale(PROJECTION_IDS.sections, 'pages:a.md');
    // What `update_sections` asks before it knows which page it addresses: a
    // marking on one page must not refuse a write to another.
    expect(reg.isGloballyStale(PROJECTION_IDS.sections)).toBe(false);
    expect(() => reg.assertNotGloballyStale(PROJECTION_IDS.sections)).not.toThrow();
    reg.markStale(PROJECTION_IDS.sections);
    expect(() => reg.assertNotGloballyStale(PROJECTION_IDS.sections)).toThrow(/INDEX_STALE|marked stale/);
  });

  it('reports which projections refuse reads and which only carry the flag', () => {
    const { reg } = rig();
    const by = Object.fromEntries(reg.snapshot().map((r) => [r.id, r.refusesReads]));
    // M02 and M08 are not exceptions to fail-closed — they have no grounds for
    // it. Their records carry a caller-supplied key and navigation targets, so
    // the cost of their staleness is a view, never content.
    expect(by[PROJECTION_IDS.frontmatter]).toBe(false);
    expect(by[PROJECTION_IDS.todos]).toBe(false);
    expect(by[PROJECTION_IDS.sections]).toBe(true);
    expect(by[PROJECTION_IDS.pageLinks]).toBe(true);
    expect(by[PROJECTION_IDS.entities]).toBe(true);
    expect(by[PROJECTION_IDS.releases]).toBe(true);
  });
});

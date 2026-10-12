import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { FileWatchRuntime, type ScopedWatchRegistrar, type WatchSubscriber } from '../fs/watcher.js';
import { ReactionBinder, validateKindRequirements } from '../fs/reactions.js';
import { FileVersionService } from '../services/file-version.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { ChatService } from '../services/chat.js';
import { PlanService } from '../services/plan.js';
import { RootRegistry } from '../roots/registry.js';
import { KIND_DECLARATIONS, PLAN_HEADER } from '../../shared/root-kinds.js';
import { ANCHOR_LINE_RE } from '../../shared/anchor-pattern.js';
import type { Root, WsEvent } from '../../shared/types.js';
import { artifactAnchorInjectionSubscriber, injectAnchorsFor } from '../services/anchor-injection.js';
import { parseSections } from '../../shared/section-parser.js';
import { anchorHeadingLevels } from '../../shared/root-kinds.js';
import { registerCoreReactions, type CoreReactionContext } from './core-reactions.js';
import { bindRegistryReactions, mountRegistryRoots } from './root-registry-runtime.js';

/**
 * 2.1.8 — M10 declares the root kind `plans` (q1txzrf0) and is the consumer of
 * that kind (implngws): the L13 implementor mounts the `plans` root's source
 * and binds the reactions the kind selects; M36 mounts nothing (wbyljxtx).
 * Deterministic watcher mode (`fsEvents: false`): `flush` runs the chain as an
 * outside edit (`origin: 'external'`).
 */

const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];
const dbs: Database.Database[] = [];

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const d of dbs.splice(0)) d.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

registerCoreReactions();

const NOOP: WatchSubscriber = { onChange: () => {}, onUnlink: () => {} };
const USER_ROOTS: Root[] = [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }];

/** The registry built and bound the way the context build does it, with the M06 write-back for the plans source. */
async function boundPlansRoot() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-plans-root-'));
  tmpDirs.push(cwd);
  const runtime = new FileWatchRuntime({ fsEvents: false });
  runtimes.push(runtime);
  const w = runtime.scoped('context:p1#1');
  const registry = new RootRegistry(USER_ROOTS);
  const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });
  // The plans root — asked of the registry BY KIND.
  const plans = registry.system('plans');
  const source = mounted.sourceByRootId.get(plans.id)!;
  const mount = mounted.artifactMounts.get('plan')!;
  const injection = artifactAnchorInjectionSubscriber(mount.kind, mount, (s, p) => w.suppress(s, p));
  const events: WsEvent[] = [];
  const ctx: CoreReactionContext = {
    ws: { broadcast: (e: WsEvent) => void events.push(e) } as unknown as CoreReactionContext['ws'],
    frontmatterIndexer: NOOP,
    anchorInjectionFor: (s) => (s === source ? injection : NOOP),
    sectionIndexer: NOOP,
    todosIndexer: NOOP,
    linkIndexer: NOOP,
    versionCapture: NOOP,
    entityIndexer: NOOP,
    releaseIndexer: NOOP,
    // 2.1.9 — the `skills` kind (M52) declares a reducer: a full-registry binding binds `m02-sidebar-reducer`.
    sidebarReducer: NOOP,
  };
  const binder = new ReactionBinder(w, ctx);
  bindRegistryReactions(registry, mounted.sourceByRootId, binder);
  return { cwd, w, plans, source, mount, binder, events };
}

describe('M10 — the `plans` root kind (2.1.8)', () => {
  it('declares the plans kind: one code root `.claude4spec/plans`, `*.md` with the plan header contract on `file_version`, gitignore only, four reactions', async () => {
    const decl = KIND_DECLARATIONS.plans;
    expect(decl).toEqual({
      kind: 'plans',
      source: 'code',
      sidebar: 'hidden',
      fileMap: [{ pattern: '*.md', format: 'markdown', track: 'file_version', header: PLAN_HEADER }],
      flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
      reactions: ['m06-anchor-injection', 'm02-frontmatter-indexer', 'm17-capture', 'm10-plan-updated'],
    });
    expect(PLAN_HEADER.mutable).toEqual(['title', 'applied']);

    const { plans, mount, source, binder } = await boundPlansRoot();
    expect(plans).toMatchObject({ id: 'plans', kind: 'plans', dir: '.claude4spec/plans', builtin: false });
    // The store M10 works on is the root's own, keyed by the root's id.
    expect(mount.rootId).toBe('plans');
    expect(mount.store.rootId).toBe('plans');
    for (const id of decl.reactions) expect(binder.isBound(id, source), id).toBe(true);
    expect(binder.isBound('m02-file-changed', source)).toBe(true);
    expect(binder.isBound('m06-section-indexer', source)).toBe(false);
  });

  it('[ac:ac-nowy-naglowek-zapisany-w-pliku-planu] a new heading written to a plan file gets an anchor line, although the plans kind does not select the section indexer', async () => {
    const { cwd, w, plans, source, binder } = await boundPlansRoot();
    // The kind selects the injection, not the indexer.
    expect(KIND_DECLARATIONS.plans.reactions).toContain('m06-anchor-injection');
    expect(KIND_DECLARATIONS.plans.reactions).not.toContain('m06-section-indexer');
    expect(binder.isBound('m06-anchor-injection', source)).toBe(true);
    expect(binder.isBound('m06-section-indexer', source)).toBe(false);

    // A plan file written from disk with a heading that has no anchor.
    const file = path.join(cwd, plans.dir, 'rollout.md');
    fs.writeFileSync(file, ['---', 'type: plan', 'title: Rollout', '---', '# Rollout', '', '## New heading', '', 'body', ''].join('\n'));
    await w.flush(source, 'rollout.md');

    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    const at = lines.indexOf('## New heading');
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toMatch(ANCHOR_LINE_RE);
    // The frontmatter block is untouched and the anchor is written exactly once.
    expect(lines.slice(0, 4)).toEqual(['---', 'type: plan', 'title: Rollout', '---']);
    expect(lines.filter((l) => ANCHOR_LINE_RE.test(l))).toHaveLength(1);
  });

  /**
   * M06 `v9zrytp8` (2.1.14): the plans kind selects injection without the
   * section indexer, so its range is `##`–`####` — on BOTH triggers: the
   * write-back of a file written on disk, and the service's own write path
   * (`PlanService.update` / plan creation run `injectAnchorsFor('plan', …)`).
   */
  function levelsAndAnchors(body: string): Array<[number, string | null]> {
    return parseSections(body, { frontmatter: false }).sections.map((s) => [s.level, s.anchor]);
  }
  const PLAN_BODY = ['# Rollout', '', '## Step', '', '##### Fine print', '', 'x', ''];

  it('[ac:ac-naglowek-dopisany-do-planu-nie-dostaj] a `#####` heading added to a plan gets no anchor — written on disk, and written through the plan service', async () => {
    expect(anchorHeadingLevels('plans')).toEqual({ min: 2, max: 4 });
    const { cwd, w, plans, source } = await boundPlansRoot();

    // Trigger two: the write-back of a plan file written on disk.
    const file = path.join(cwd, plans.dir, 'deep.md');
    fs.writeFileSync(file, ['---', 'type: plan', 'title: Rollout', '---', ...PLAN_BODY].join('\n'));
    await w.flush(source, 'deep.md');
    const onDisk = fs.readFileSync(file, 'utf-8').split('\n');
    expect(onDisk[onDisk.indexOf('##### Fine print') - 1]).not.toMatch(ANCHOR_LINE_RE);
    expect(onDisk[onDisk.indexOf('## Step') - 1]).toMatch(ANCHOR_LINE_RE); // the pass did run
    expect(levelsAndAnchors(onDisk.slice(4).join('\n')).find(([l]) => l === 5)).toEqual([5, null]);

    // Trigger one: the service's own write path — the same range.
    const viaService = injectAnchorsFor('plan', PLAN_BODY.join('\n'));
    expect(levelsAndAnchors(viaService)).toEqual([
      [1, null],
      [2, expect.stringMatching(/^[a-z0-9]{8}$/)],
      [5, null],
    ]);
  });

  it('[ac:ac-naglowek-dopisany-do-planu-nie-dostaj-2] a `#` heading added to a plan gets no anchor — written on disk, and written through the plan service', async () => {
    const { cwd, w, plans, source } = await boundPlansRoot();

    // Trigger two: the write-back of a plan file written on disk.
    const file = path.join(cwd, plans.dir, 'title.md');
    fs.writeFileSync(file, ['---', 'type: plan', 'title: Rollout', '---', ...PLAN_BODY].join('\n'));
    await w.flush(source, 'title.md');
    const onDisk = fs.readFileSync(file, 'utf-8').split('\n');
    // The `#` stays the first content after the frontmatter — no anchor line between.
    expect(onDisk.slice(0, 5)).toEqual(['---', 'type: plan', 'title: Rollout', '---', '# Rollout']);
    expect(onDisk[onDisk.indexOf('## Step') - 1]).toMatch(ANCHOR_LINE_RE); // the pass did run
    expect(levelsAndAnchors(onDisk.slice(4).join('\n'))[0]).toEqual([1, null]);

    // Trigger one: the service's own write path — the same range.
    const viaService = injectAnchorsFor('plan', PLAN_BODY.join('\n'));
    expect(viaService.split('\n')[0]).toBe('# Rollout');
    expect(levelsAndAnchors(viaService)[0]).toEqual([1, null]);
  });

  it('an outside edit of a plan file is announced by the base `file:changed`; `m10-plan-updated` is not fired by the watcher', async () => {
    const { cwd, w, plans, source, events } = await boundPlansRoot();
    fs.writeFileSync(path.join(cwd, plans.dir, 'edit.md'), ['---', 'type: plan', 'title: Edit', '---', 'x', ''].join('\n'));
    await w.flush(source, 'edit.md');

    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'file:changed', rootId: 'plans', path: 'edit.md', origin: 'external' }),
    );
    expect(events.filter((e) => e.kind === 'plans:changed' || e.kind === 'plan:updated')).toEqual([]);
  });
});

/**
 * 2.1.14 — M10 jo0r7uh9 (Przebieg wywołania, steps 4–5) and m10ws000 (L7): the
 * plan service writes the file through the M42 primitive with the phase chain
 * switched off, then records the version itself with the caller's
 * `changeSummary`, then broadcasts `plan:updated` with the version just
 * recorded. `m10-plan-updated` requires nothing and runs in its own phase
 * `notification`, with no `after: [capture]`.
 *
 * The rig is the registry built and bound the way the context build does it,
 * every reaction the `plans` kind selects bound on the source — but each
 * handler a SPY on its own WS, so any in-band chain run would show — plus a
 * `PlanService` over the root's mount (store, writer, record store, serializer)
 * exactly as `buildProjectContext` wires it.
 */
async function planServiceOnBoundPlansRoot() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-plans-seq-'));
  tmpDirs.push(cwd);
  const db = createTestDb();
  dbs.push(db);
  db.prepare(`INSERT INTO chat_thread (id) VALUES (?)`).run('t1');
  const runtime = new FileWatchRuntime({ fsEvents: false });
  runtimes.push(runtime);
  const w = runtime.scoped('context:p1#1');
  const registry = new RootRegistry(USER_ROOTS);
  const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });
  const mount = mounted.artifactMounts.get('plan')!;
  const source = mounted.sourceByRootId.get(mount.rootId)!;

  // Every chain handler records that it ran; the chain's own WS (base
  // `file:changed`, `m10-plan-updated`'s handler) is kept apart from the service's.
  const chainRuns: string[] = [];
  const chainEvents: WsEvent[] = [];
  const spy = (name: string): WatchSubscriber => ({
    onChange: () => void chainRuns.push(name),
    onUnlink: () => void chainRuns.push(name),
  });
  const ctx: CoreReactionContext = {
    ws: { broadcast: (e: WsEvent) => void chainEvents.push(e) } as unknown as CoreReactionContext['ws'],
    frontmatterIndexer: spy('m02-frontmatter-indexer'),
    anchorInjectionFor: () => spy('m06-anchor-injection'),
    sectionIndexer: spy('m06-section-indexer'),
    todosIndexer: NOOP,
    linkIndexer: NOOP,
    versionCapture: spy('m17-capture'),
    entityIndexer: NOOP,
    releaseIndexer: NOOP,
    sidebarReducer: NOOP,
  };
  const binder = new ReactionBinder(w, ctx);
  bindRegistryReactions(registry, mounted.sourceByRootId, binder);

  // The sequence log: what the file held when the version was recorded, the
  // version recorded, and the service's broadcasts.
  const order: string[] = [];
  const serviceEvents: WsEvent[] = [];
  const versions = new FileVersionService(db, mount.serializer);
  const realRecord = versions.recordVersion.bind(versions);
  let marker = '';
  vi.spyOn(versions, 'recordVersion').mockImplementation(async (...args: Parameters<FileVersionService['recordVersion']>) => {
    const onDisk = fs.readFileSync(path.join(mount.store.root, args[0]), 'utf-8');
    order.push(`version:file-has-${onDisk.includes(marker) ? marker : 'OLD'}`);
    const row = await realRecord(...args);
    order.push(`version:recorded:${row?.version}`);
    return row;
  });
  const serviceWs = {
    broadcast: (e: WsEvent) => {
      serviceEvents.push(e);
      order.push(`broadcast:${e.kind}:${'version' in e ? String(e.version) : ''}`);
    },
  } as unknown as CoreReactionContext['ws'];
  const indexer = new PagesFrontmatterIndexer(
    new Map([[mount.rootId, mount.store]]),
    { broadcast: () => {} } as unknown as CoreReactionContext['ws'],
  );
  const service = new PlanService({
    plansPages: mount.store,
    plansWatcher: mount.writer,
    plansRecords: mount.store.records,
    plansSerializer: mount.serializer,
    pageVersions: versions,
    chatService: new ChatService(db),
    frontmatterIndexer: indexer,
    ws: serviceWs,
  });
  return {
    source,
    binder,
    mount,
    service,
    versions,
    order,
    serviceEvents,
    chainRuns,
    chainEvents,
    setMarker: (m: string) => {
      marker = m;
      order.length = 0;
      serviceEvents.length = 0;
    },
  };
}

describe('M10 — the plan write sequence: file → version → broadcast (2.1.14)', () => {
  it('[section:jo0r7uh9] persist writes the file with the chain off, the service then records ONE version with the caller\'s changeSummary, and broadcasts plan:updated with the version just recorded — in that order', async () => {
    const r = await planServiceOnBoundPlansRoot();

    // Create through `update` (no plan pinned yet): version 1, summary from the caller.
    r.setMarker('MARK1');
    const first = await r.service.update({
      threadId: 't1',
      title: 'Rollout',
      content: '## Step\n\nMARK1\n',
      changeSummary: 'first draft',
      changedBy: 'agent',
    });
    expect(r.order).toEqual(['version:file-has-MARK1', 'version:recorded:1', 'broadcast:plan:updated:1']);
    expect(first.version).toBe(1);

    // Update of an existing plan: version 2.
    r.setMarker('MARK2');
    const second = await r.service.update({
      threadId: 't1',
      content: '## Step\n\nMARK2\n',
      expectedHash: first.hash,
      changeSummary: 'second pass',
      changedBy: 'agent',
    });
    expect(r.order).toEqual(['version:file-has-MARK2', 'version:recorded:2', 'broadcast:plan:updated:2']);
    expect(second.version).toBe(2);
    expect(r.serviceEvents).toEqual([
      { kind: 'plan:updated', planPath: first.plan.path, threadId: 't1', version: 2, changedBy: 'agent' },
    ]);

    // The editor's Save — the same tail: file → version → broadcast.
    r.setMarker('MARK3');
    await r.service.updateContent({
      path: first.plan.path,
      content: second.plan.content.replace('MARK2', 'MARK3'),
      expectedHash: second.hash,
      changeSummary: 'edited by hand',
      changedBy: 'user',
    });
    expect(r.order).toEqual(['version:file-has-MARK3', 'version:recorded:3', 'broadcast:plan:updated:3']);

    // ONE row per call, each carrying the caller's summary — the service's own rows, nothing from a capture phase.
    const rows = r.versions.listVersions(first.plan.path, r.mount.rootId);
    expect(rows.map((v) => [v.version, v.changeSummary])).toEqual([
      [3, 'edited by hand'],
      [2, 'second pass'],
      [1, 'first draft'],
    ]);
  });

  it('[section:m10ws000] m10-plan-updated requires nothing and runs in its own phase `notification` with no `after`; the plan\'s own write runs no phase chain, so the definition is not fired in-band', async () => {
    // Requirements: none — a kind selecting it without `m17-capture` passes the build check.
    expect(() =>
      validateKindRequirements({ ...KIND_DECLARATIONS.plans, reactions: ['m10-plan-updated'] }),
    ).not.toThrow();

    // Order: own phase `notification`, independent — no `after: [capture]`.
    const subscriptions: Array<{ id?: string; phase?: string; after?: readonly string[] }> = [];
    const registrar = {
      subscribe: (_src: string, _sub: WatchSubscriber, opts: { id?: string; phase?: string; after?: readonly string[] }) =>
        void subscriptions.push(opts),
    } as unknown as ScopedWatchRegistrar;
    const ctx = { ws: { broadcast: () => {} } } as unknown as CoreReactionContext;
    new ReactionBinder(registrar, ctx).bindReaction('m10-plan-updated', 'artifacts:plan', 'plans', { rootId: 'plans' });
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({ id: 'm10-plan-updated', phase: 'notification', after: [] });

    // Still bound to the `plans` root — but the service's own write fires neither it nor any other phase.
    const r = await planServiceOnBoundPlansRoot();
    expect(r.binder.isBound('m10-plan-updated', r.source)).toBe(true);
    expect(r.binder.isBound('m17-capture', r.source)).toBe(true);
    r.setMarker('MARK1');
    const first = await r.service.update({
      threadId: 't1',
      title: 'Chain off',
      content: '## Step\n\nMARK1\n',
      changeSummary: 'first',
      changedBy: 'agent',
    });
    r.setMarker('MARK2');
    await r.service.update({
      threadId: 't1',
      content: '## Step\n\nMARK2\n',
      expectedHash: first.hash,
      changeSummary: 'second',
      changedBy: 'agent',
    });
    expect(r.chainRuns).toEqual([]);
    expect(r.chainEvents).toEqual([]);
    // The broadcast is the service's, after its own recordVersion — exactly one per call.
    expect(r.serviceEvents.filter((e) => e.kind === 'plan:updated')).toHaveLength(1);
    expect(r.order.at(-1)).toBe('broadcast:plan:updated:2');
  });
});

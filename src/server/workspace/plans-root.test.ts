import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileWatchRuntime, type WatchSubscriber } from '../fs/watcher.js';
import { ReactionBinder } from '../fs/reactions.js';
import { RootRegistry } from '../roots/registry.js';
import { KIND_DECLARATIONS, PLAN_HEADER } from '../../shared/root-kinds.js';
import { ANCHOR_LINE_RE } from '../../shared/anchor-pattern.js';
import type { Root, WsEvent } from '../../shared/types.js';
import { artifactAnchorInjectionSubscriber } from '../services/anchor-injection.js';
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

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
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

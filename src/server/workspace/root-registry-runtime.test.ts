import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { FileWatchRuntime, type WatchSubscriber } from '../fs/watcher.js';
import { ReactionBinder, validateKindRequirements, type ReactionHandler } from '../fs/reactions.js';
import { RootRegistry } from '../roots/registry.js';
import { KIND_DECLARATIONS, kindDeclaration } from '../../shared/root-kinds.js';
import { PagesService } from '../services/pages.js';
import { MarkdownFileStore } from '../services/markdown-file-store.js';
import { configPath } from '../config.js';
import { configRouter } from '../routes/config.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import type { Root, WsEvent } from '../../shared/types.js';
import { registerCoreReactions, type CoreReactionContext } from './core-reactions.js';
import { ProjectContextCache } from './context-cache.js';
import type { ProjectContext } from './project-context.js';
import type { ProjectRecord } from './types.js';
import { bindRegistryReactions, mountRegistryRoots } from './root-registry-runtime.js';
import { RootSet } from '../discovery/roots.js';
import { ReleaseFileStore } from '../services/release-store.js';

/**
 * 2.1.8 — the build hook of the L13 implementor (M02), run while M31 builds a
 * `ProjectContext`: N `PagesService` facades (one per `kind: pages` root), a
 * mounted M40 source and the bound reactions for EVERY registry root; dispose
 * takes all of them down; a `roots[]` change invalidates the context and the
 * rebuild runs the hook again. Deterministic watcher mode (`fsEvents: false`).
 */

const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-root-runtime-'));
  tmpDirs.push(d);
  return d;
}

function runtime(): FileWatchRuntime {
  const r = new FileWatchRuntime({ fsEvents: false });
  runtimes.push(r);
  return r;
}

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const NOOP: WatchSubscriber = { onChange: () => {}, onUnlink: () => {} };

function coreCtx(events: WsEvent[]): CoreReactionContext {
  return {
    ws: { broadcast: (e: WsEvent) => void events.push(e) } as unknown as CoreReactionContext['ws'],
    frontmatterIndexer: NOOP,
    anchorInjectionFor: () => NOOP,
    sectionIndexer: NOOP,
    todosIndexer: NOOP,
    linkIndexer: NOOP,
    versionCapture: NOOP,
    entityIndexer: NOOP,
    releaseIndexer: NOOP,
  };
}

registerCoreReactions();

const USER_ROOTS: Root[] = [
  { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
  { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false },
];

const fileChanged = (events: WsEvent[]) =>
  (events.filter((e) => e.kind === 'file:changed') as Array<Extract<WsEvent, { kind: 'file:changed' }>>).map(
    (e) => [e.rootId, e.path],
  );

describe('2.1.8 — root-registry runtime per ProjectContext (M02 m02multidir, L13)', () => {
  it('[ac:ac-projectcontext-montuje-n-par-pagesservic] N PagesService facades (one per pages root), every registry root mounted and bound by the build hook; dispose takes down every source and binding; a roots[] change invalidates and the rebuild re-runs the hook', async () => {
    const cwd = tmp();
    const r = runtime();
    const w = r.scoped('context:p1#1');
    const registry = new RootRegistry(USER_ROOTS);
    const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });

    // N facades — exactly the `kind: pages` roots, each its own PagesService.
    expect(mounted.rootRuntimes.map((rt) => rt.root.id)).toEqual(['pages', 'adr']);
    for (const rt of mounted.rootRuntimes) expect(rt.pages).toBeInstanceOf(PagesService);
    expect(mounted.rootRuntimes[0]!.pages).not.toBe(mounted.rootRuntimes[1]!.pages);
    // System roots get a markdown store where their kind has markdown entries, never a facade.
    expect([...mounted.artifactMounts.values()].map((m) => m.rootId).sort()).toEqual(['briefs', 'patches', 'plans']);

    // The hook mounts a source for EVERY registry root — user and system roots alike.
    const allIds = registry.list().map((root) => root.id);
    expect([...mounted.sourceByRootId.keys()]).toEqual(allIds);
    expect(allIds).toEqual(expect.arrayContaining(['pages', 'adr', 'plans', 'briefs', 'patches', 'entities', 'releases']));
    for (const source of mounted.sourceByRootId.values()) expect(w.isMounted(source)).toBe(true);
    for (const root of registry.list()) expect(fs.existsSync(path.join(cwd, root.dir))).toBe(true);

    // … and binds the kind's reactions + the base one on every root.
    const events: WsEvent[] = [];
    bindRegistryReactions(registry, mounted.sourceByRootId, new ReactionBinder(w, coreCtx(events)));
    fs.writeFileSync(path.join(cwd, 'docs/adr', 'a.md'), '# A\n');
    await w.flush(mounted.sourceByRootId.get('adr')!, 'a.md');
    const entitiesDir = registry.get('entities')!.dir;
    fs.mkdirSync(path.join(cwd, entitiesDir, 'endpoint'), { recursive: true });
    fs.writeFileSync(path.join(cwd, entitiesDir, 'endpoint', 'e.json'), '{}');
    await w.flush(mounted.sourceByRootId.get('entities')!, 'endpoint/e.json');
    expect(fileChanged(events)).toEqual([
      ['adr', 'a.md'],
      ['entities', 'endpoint/e.json'],
    ]);

    // Dispose: every registry source is unmounted and its bindings are gone —
    // a fresh mount in the same scope dispatches to nobody.
    await w.dispose();
    for (const source of mounted.sourceByRootId.values()) expect(w.isMounted(source)).toBe(false);
    const adrSource = mounted.sourceByRootId.get('adr')!;
    w.mountSource({ source: adrSource, dir: path.join(cwd, 'docs/adr') });
    fs.writeFileSync(path.join(cwd, 'docs/adr', 'a.md'), '# A2\n');
    await w.flush(adrSource, 'a.md');
    expect(fileChanged(events)).toHaveLength(2);
    await w.unmountSource(adrSource);

    // A roots[] save invalidates the context: `roots` is a context-rebuild field,
    // so PATCH /config pings the invalidation hook …
    fs.mkdirSync(path.dirname(configPath(cwd)), { recursive: true });
    fs.writeFileSync(configPath(cwd), JSON.stringify({ $schemaVersion: 4, name: 'test', roots: USER_ROOTS }));
    fs.mkdirSync(path.join(cwd, 'specs'), { recursive: true });
    const onContextConfigChanged = vi.fn();
    const nextRoots: Root[] = [...USER_ROOTS, { id: 'specs', name: 'Specs', dir: 'specs', builtin: false }];
    const skillStub = { isSelectable: () => false, listSelectable: () => [] } as unknown as SkillRegistry;
    await request(express().use(express.json()).use(configRouter({ cwd, skillRegistry: skillStub, onContextConfigChanged })))
      .patch('/config')
      .send({ roots: nextRoots })
      .expect(200);
    expect(onContextConfigChanged).toHaveBeenCalledTimes(1);

    // … which the server wires to `cache.invalidate`: the old context is disposed
    // and the next request builds a new one …
    const built: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    const cache = new ProjectContextCache(async () => {
      const ctx = { projectId: 'p1', hasInFlightTurn: () => false, dispose: vi.fn(async () => {}) };
      built.push(ctx);
      return ctx as unknown as ProjectContext;
    }, 4);
    const project = { id: 'p1' } as ProjectRecord;
    await cache.get(project);
    cache.invalidate('p1');
    await cache.get(project);
    expect(built).toHaveLength(2);
    await vi.waitFor(() => expect(built[0]!.dispose).toHaveBeenCalled());

    // … whose build hook runs again over the new registry: N+1 facades, every root mounted.
    const w2 = r.scoped('context:p1#2');
    const registry2 = new RootRegistry(nextRoots);
    const remounted = await mountRegistryRoots({ cwd, registry: registry2, userRoots: nextRoots, w: w2 });
    expect(remounted.rootRuntimes.map((rt) => rt.root.id)).toEqual(['pages', 'adr', 'specs']);
    for (const source of remounted.sourceByRootId.values()) expect(w2.isMounted(source)).toBe(true);
    expect(() =>
      bindRegistryReactions(registry2, remounted.sourceByRootId, new ReactionBinder(w2, coreCtx(events))),
    ).not.toThrow();
    // (The build-order source check — mount, bind, then boot indexAll — lives in
    // tests/integration/architecture/registry-mounts-source.test.ts.)
  });

  it('[ac:ac-section-indexer-walidacja-referencji-i] section index, reference validation and version capture follow the reactions and flags of the root\'s KIND, not fields of its entry; files of a kind without m06-anchor-injection get no anchors', async () => {
    const cwd = tmp();
    const w = runtime().scoped('context:p3#1');
    // A user root entry still carrying the retired per-root switches, all OFF.
    const legacy = {
      id: 'adr',
      name: 'ADRs',
      dir: 'docs/adr',
      builtin: false,
      sectionIndexed: false,
      releasable: false,
      referenceValidated: false,
    } as Root;
    const roots: Root[] = [USER_ROOTS[0]!, legacy];
    const registry = new RootRegistry(roots);

    // The sets every consumer iterates are derived from the kind: the switches
    // on the entry change nothing — `adr` is indexed, validated and captured.
    expect(registry.get('adr')).toEqual({ id: 'adr', name: 'ADRs', dir: 'docs/adr', kind: 'pages', builtin: false });
    expect(registry.selecting('m06-section-indexer').map((r) => r.id)).toEqual(['pages', 'adr']);
    expect(registry.withFlag('references').map((r) => r.id)).toEqual(['pages', 'adr']);
    expect(registry.selecting('m17-capture').map((r) => r.id)).toEqual(
      expect.arrayContaining(['pages', 'adr', 'plans', 'briefs', 'patches']),
    );
    const pageCore = new RootSet(roots);
    expect(pageCore.sectionIndexed().map((r) => r.id)).toEqual(['pages', 'adr']);
    expect(pageCore.referenceValidated().map((r) => r.id)).toEqual(['pages', 'adr']);
    // A kind that did not select the indexer / has `references = false` is out
    // of both sets, whatever its entry says.
    for (const kind of ['briefs', 'patches'] as const) {
      expect(registry.selecting('m06-section-indexer').some((r) => r.kind === kind)).toBe(false);
      expect(registry.withFlag('references').some((r) => r.kind === kind)).toBe(false);
      expect(kindDeclaration(kind).reactions).not.toContain('m06-anchor-injection');
    }

    // The runtime: what the build hook binds per root is what runs per file.
    const mounted = await mountRegistryRoots({ cwd, registry, userRoots: roots, w });
    const ran: string[] = [];
    const rec = (name: string) => ({
      onChange: (_s: unknown, _src: string, rel: string, _o: unknown, input: { rootId: string }) =>
        void ran.push(`${name}@${input.rootId}:${rel}`),
      onUnlink: () => {},
    });
    // A stand-in write-back that appends an anchor line — so a file it reached
    // would carry an anchor on disk.
    const injectedSources: string[] = [];
    const injector = (source: string) => ({
      onChange: (_s: unknown, _src: string, rel: string, _o: unknown, input: { rootId: string }) => {
        injectedSources.push(source);
        const abs = path.join(cwd, registry.get(input.rootId)!.dir, rel);
        fs.appendFileSync(abs, '<!-- anchor: injected -->\n');
      },
      onUnlink: () => {},
    });
    const ctx = {
      ...coreCtx([]),
      anchorInjectionFor: injector,
      sectionIndexer: rec('index'),
      versionCapture: rec('capture'),
    } as unknown as CoreReactionContext;
    bindRegistryReactions(registry, mounted.sourceByRootId, new ReactionBinder(w, ctx));

    const body = '# Title\n\n## Section\n\ntext\n';
    for (const id of ['adr', 'briefs', 'patches']) {
      fs.writeFileSync(path.join(cwd, registry.get(id)!.dir, 'doc.md'), body);
      await w.flush(mounted.sourceByRootId.get(id)!, 'doc.md');
    }

    // `adr` (kind pages, switches off on the entry): anchored, indexed, captured.
    expect(fs.readFileSync(path.join(cwd, 'docs/adr', 'doc.md'), 'utf8')).toContain('anchor: injected');
    expect(ran).toContain('index@adr:doc.md');
    expect(ran).toContain('capture@adr:doc.md');
    // briefs / patches (kinds without the injection or the indexer): captured,
    // never indexed, and their files carry no anchor — byte-for-byte unchanged.
    for (const id of ['briefs', 'patches']) {
      expect(ran).toContain(`capture@${id}:doc.md`);
      expect(ran).not.toContain(`index@${id}:doc.md`);
      expect(injectedSources).not.toContain(mounted.sourceByRootId.get(id));
      expect(fs.readFileSync(path.join(cwd, registry.get(id)!.dir, 'doc.md'), 'utf8')).toBe(body);
    }
  });

  it('[entity:page-root-runtime-construction] the loop over the registry: mount per root, a MarkdownFileStore primitive per markdown kind (bare for plans/briefs/patches), the PagesService facade over it only for kind pages, kind reactions + base reaction bound on every root', async () => {
    const cwd = tmp();
    const w = runtime().scoped('context:p2#1');
    const registry = new RootRegistry(USER_ROOTS);
    const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });
    // Markdown store: every kind whose file map has a markdown entry (pages + plans/briefs/patches),
    // and it is the bare PRIMITIVE — never a facade, whatever the root's kind.
    expect([...mounted.storeByRootId.keys()].sort()).toEqual(['adr', 'briefs', 'pages', 'patches', 'plans']);
    for (const [rootId, store] of mounted.storeByRootId) {
      expect(store, rootId).toBeInstanceOf(MarkdownFileStore);
      expect(store, rootId).not.toBeInstanceOf(PagesService);
      expect(store.rootId).toBe(rootId);
      expect(store.root).toBe(path.join(cwd, registry.get(rootId)!.dir));
    }
    // System roots plans/briefs/patches: the store with NO facade over it.
    for (const m of mounted.artifactMounts.values()) {
      expect(m.store).toBe(mounted.storeByRootId.get(m.rootId));
      expect(m.store).not.toBeInstanceOf(PagesService);
      expect(m).not.toHaveProperty('pages');
    }
    // Facade: kind pages only — `new PagesService({ root, store })` over THAT root's store.
    expect(mounted.rootRuntimes.map((rt) => rt.root.id)).toEqual(registry.pages().map((r) => r.id));
    for (const rt of mounted.rootRuntimes) {
      expect(registry.get(rt.root.id)!.kind).toBe('pages');
      expect(rt.pages).toBeInstanceOf(PagesService);
      expect(rt.pages.store).toBe(mounted.storeByRootId.get(rt.root.id));
      expect(rt.pages.rootId).toBe(rt.root.id);
    }
    // A facade over another root's store is refused.
    expect(
      () => new PagesService({ root: USER_ROOTS[0]!, store: mounted.storeByRootId.get('adr')! }),
    ).toThrow(/facade for root 'pages' over the store of 'adr'/);
    // entities / releases: a source, no store.
    expect(mounted.storeByRootId.has('entities')).toBe(false);
    expect(mounted.sourceByRootId.has('entities')).toBe(true);
    expect(mounted.sourceByRootId.has('releases')).toBe(true);
    // Step 4 on every root: the kind's reactions, then the base `m02-file-changed`, each with the root's id.
    const calls: Array<[string, string, string]> = [];
    const recorder = {
      bindReaction: (id: string, source: string, _kind: string, input: { rootId: string }) =>
        void calls.push([input.rootId, id, source]),
    } as unknown as ReactionBinder<CoreReactionContext>;
    bindRegistryReactions(registry, mounted.sourceByRootId, recorder);
    for (const root of registry.list()) {
      const ids = calls.filter(([rootId]) => rootId === root.id).map(([, id]) => id);
      expect(ids, root.id).toEqual([...kindDeclaration(root.kind).reactions, 'm02-file-changed']);
      for (const [rootId, , source] of calls) if (rootId === root.id) expect(source).toBe(mounted.sourceByRootId.get(root.id));
    }
    // Binding before a mount is fail-fast (mount → bind is a contract per source).
    const unmounted = new Map(mounted.sourceByRootId);
    unmounted.delete('adr');
    expect(() => bindRegistryReactions(registry, unmounted, new ReactionBinder(w, coreCtx([])))).toThrow(
      /'adr' has no mounted source/,
    );
  });

  it('M29 m29idx001: M29 mounts no source — the L13 implementor mounts the `entities` root and binds m29-entity-indexer there (json: entity files + tags.json, input rootId `entities`, no requirements); m29-release-cache is a json projection definition with no requirements', async () => {
    const cwd = tmp();
    const w = runtime().scoped('context:m29');
    const registry = new RootRegistry(USER_ROOTS);
    const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });
    const entitiesSource = mounted.sourceByRootId.get('entities')!;
    expect(w.isMounted(entitiesSource)).toBe(true);

    // The entity indexer receives what the kind selected it for, with the binding's rootId.
    const seen: Array<[string, string]> = [];
    // The binder hands the binding's input as the handler's 5th argument.
    const entityIndexer: ReactionHandler = {
      onChange: (_s, _src, rel, _o, input) => void seen.push([input.rootId, rel]),
      onUnlink: () => {},
    };
    const binder = new ReactionBinder(w, {
      ...coreCtx([]),
      entityIndexer: entityIndexer as unknown as WatchSubscriber,
    } as CoreReactionContext);
    bindRegistryReactions(registry, mounted.sourceByRootId, binder);
    expect(binder.isBound('m29-entity-indexer', entitiesSource)).toBe(true);
    // Bound nowhere else: the selection is the kind's, not a hand-made mount.
    for (const root of registry.list()) {
      if (root.id === 'entities') continue;
      expect(binder.isBound('m29-entity-indexer', mounted.sourceByRootId.get(root.id)!), root.id).toBe(false);
    }
    const dir = path.join(cwd, registry.get('entities')!.dir);
    fs.mkdirSync(path.join(dir, 'endpoint'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tags.json'), '{"tags":[]}');
    fs.writeFileSync(path.join(dir, 'endpoint', 'a.json'), '{}');
    fs.writeFileSync(path.join(dir, 'notes.md'), '# not json\n');
    for (const rel of ['tags.json', 'endpoint/a.json', 'notes.md']) await w.flush(entitiesSource, rel);
    expect(seen).toEqual([
      ['entities', 'tags.json'],
      ['entities', 'endpoint/a.json'],
    ]);

    // Both M29 definitions: no requirement on reactions or flags.
    for (const id of ['m29-entity-indexer', 'm29-release-cache']) {
      expect(() =>
        validateKindRequirements({
          ...KIND_DECLARATIONS.entities,
          reactions: [id],
          flags: { release: false, references: false, gitignore: false, agentDirectFs: false },
        }),
      ).not.toThrow();
    }

  });

  it('M29 m29idx001: the L13 implementor mounts the `releases` root (fixed `.claude4spec/releases`) and binds m29-release-cache there because the `releases` kind selects it — json `<slug>.json` only, input rootId `releases`, cache key = slug from the path', async () => {
    const cwd = tmp();
    const w = runtime().scoped('context:m29-releases');
    const registry = new RootRegistry(USER_ROOTS);
    const root = registry.get('releases')!;
    expect(root.kind).toBe('releases');
    expect(root.dir).toBe('.claude4spec/releases');
    expect(KIND_DECLARATIONS.releases.reactions).toContain('m29-release-cache');
    const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });
    const releasesSource = mounted.sourceByRootId.get('releases')!;
    expect(w.isMounted(releasesSource)).toBe(true);

    const seen: Array<[string, string]> = [];
    const releaseIndexer: ReactionHandler = {
      onChange: (_s, _src, rel, _o, input) => void seen.push([input.rootId, rel]),
      onUnlink: () => {},
    };
    const binder = new ReactionBinder(w, {
      ...coreCtx([]),
      releaseIndexer: releaseIndexer as unknown as WatchSubscriber,
    } as CoreReactionContext);
    bindRegistryReactions(registry, mounted.sourceByRootId, binder);
    expect(binder.isBound('m29-release-cache', releasesSource)).toBe(true);
    for (const r of registry.list()) {
      if (r.id === 'releases') continue;
      expect(binder.isBound('m29-release-cache', mounted.sourceByRootId.get(r.id)!), r.id).toBe(false);
    }

    // A release metadata record reaches the cache; other files of the source are skipped.
    const dir = path.join(cwd, root.dir);
    fs.writeFileSync(path.join(dir, '2-1-8.json'), '{}');
    fs.writeFileSync(path.join(dir, 'notes.md'), '# not a release\n');
    for (const rel of ['2-1-8.json', 'notes.md']) await w.flush(releasesSource, rel);
    expect(seen).toEqual([['releases', '2-1-8.json']]);
    // The cache keys on the slug derived from the path.
    const store = new ReleaseFileStore(cwd, root.dir, { suppress: () => {} });
    expect(store.parseRelPath('2-1-8.json')).toBe('2-1-8');
    expect(store.parseRelPath('notes.md')).toBeNull();
  });
});

describe('2.1.8 — event sources of the `entities` and `releases` roots (M02 m02l13001, L13)', () => {
  it('[ac:ac-zrodla-zdarzen-korzeni-entities-i-rel] the L13 implementor mounts the `entities` and `releases` sources (through the registry build hook), and no entity-projection module mounts one', async () => {
    const cwd = tmp();
    const w = runtime().scoped('context:sources');
    const registry = new RootRegistry(USER_ROOTS);
    // Nothing is mounted before the implementor's build hook runs.
    expect(w.isMounted('entities')).toBe(false);
    expect(w.isMounted('releases')).toBe(false);
    const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });
    // Both are registry roots of their own kind, at the fixed dirs, and the hook mounted their sources.
    for (const id of ['entities', 'releases'] as const) {
      const root = registry.get(id)!;
      expect(root.kind).toBe(id);
      expect(root.dir).toBe(`.claude4spec/${id}`);
      expect(mounted.sourceByRootId.get(id)).toBe(id);
      expect(w.isMounted(id)).toBe(true);
      expect(fs.existsSync(path.join(cwd, root.dir))).toBe(true);
    }
    // The source half — no M29 store/indexer mounts or watches on its own, and the
    // context build mounts no registry root by hand — is the architecture test
    // tests/integration/architecture/registry-mounts-source.test.ts.
  });

  it('[ac:ac-zmiana-pliku-w-dowolnym-korzeniu-reje] a file change in ANY registry root — entities and releases included — emits file:changed carrying that root\'s id', async () => {
    const cwd = tmp();
    const w = runtime().scoped('context:file-changed');
    const registry = new RootRegistry(USER_ROOTS);
    const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });
    const events: WsEvent[] = [];
    bindRegistryReactions(registry, mounted.sourceByRootId, new ReactionBinder(w, coreCtx(events)));

    // One file per registry root, each matching an entry of its kind's file map.
    const fileFor = (kind: string): string =>
      kind === 'entities' ? 'endpoint/e.json' : kind === 'releases' ? '2-1-8.json' : 'doc.md';
    const expected: Array<[string, string]> = [];
    for (const root of registry.list()) {
      const rel = fileFor(root.kind);
      const abs = path.join(cwd, root.dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, rel.endsWith('.json') ? '{}' : '# Doc\n');
      await w.flush(mounted.sourceByRootId.get(root.id)!, rel);
      expected.push([root.id, rel]);
    }
    expect(registry.list().map((r) => r.id)).toEqual(
      expect.arrayContaining(['pages', 'adr', 'plans', 'briefs', 'patches', 'entities', 'releases']),
    );
    expect(fileChanged(events)).toEqual(expected);
  });
});

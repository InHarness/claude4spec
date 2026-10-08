import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileWatchRuntime, type WatchSubscriber } from './watcher.js';
import { ReactionBinder, defineReaction, validateKindRequirements } from './reactions.js';
import { registerCoreReactions, type CoreReactionContext } from '../workspace/core-reactions.js';
import { KIND_DECLARATIONS, type KindDeclaration } from '../../shared/root-kinds.js';
import { ENTITIES_SOURCE, RELEASES_SOURCE, pageSource } from './sources.js';
import type { WsEvent } from '../../shared/types.js';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { FileVersionCapture } from '../services/file-version-capture.js';
import { MarkdownFileStore } from '../services/markdown-file-store.js';

/**
 * 2.1.8 — reactions on two levels: process-wide definitions, bound per source
 * by the root-registry implementor. Deterministic mode (`fsEvents: false` +
 * `flush`), as in the runtime's own tests.
 */

const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-reactions-'));
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
});

const NOOP: WatchSubscriber = { onChange: () => {}, onUnlink: () => {} };

/** A context whose subscribers do nothing except the WS emitter, which records. */
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

describe('2.1.8 — kind requirements', () => {
  it('[ac:ac-deklaracja-rodzaju-korzenia-wybieraja] a kind selecting m06-section-indexer without m06-anchor-injection stops the context build', () => {
    const broken: KindDeclaration = {
      ...KIND_DECLARATIONS.pages,
      reactions: KIND_DECLARATIONS.pages.reactions.filter((id) => id !== 'm06-anchor-injection'),
    };
    expect(() => validateKindRequirements(broken)).toThrow(/m06-section-indexer.*requires 'm06-anchor-injection'/);
    // The context build runs this check for every registry root, in the
    // registry loop, before any reaction is bound — and `buildProjectContext`
    // rethrows after its partial-build cleanup, so the throw stops the build.
    const hook = fs.readFileSync(path.join(import.meta.dirname, '../workspace/root-registry-runtime.ts'), 'utf8');
    const mountFn = hook.indexOf('export async function mountRegistryRoots(');
    const loop = hook.indexOf('for (const root of registry.list()) {', mountFn);
    const check = hook.indexOf('validateKindRequirements(kindDeclaration(root.kind));', loop);
    const firstMount = hook.indexOf('w.mountSource(', loop);
    expect(mountFn).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(mountFn);
    expect(check).toBeGreaterThan(loop);
    expect(firstMount).toBeGreaterThan(check); // first statement of the loop body
    const build = fs.readFileSync(path.join(import.meta.dirname, '../workspace/project-context.ts'), 'utf8');
    const mountCall = build.indexOf('await mountRegistryRoots(');
    const bindCall = build.indexOf('bindRegistryReactions(rootRegistry,');
    expect(mountCall).toBeGreaterThan(-1);
    expect(bindCall).toBeGreaterThan(mountCall);
    expect(build.indexOf('reactionBinder.bindReaction(')).toBe(-1); // every binding goes through the hook
    expect(build).toMatch(/return await buildInner\(deps, cleanup\);\s*\} catch \(err\) \{[\s\S]*?throw err;/);
  });

  it('a kind selecting m06-section-indexer without references = true stops the context build (M06 o8crf4hk)', () => {
    const broken: KindDeclaration = {
      ...KIND_DECLARATIONS.pages,
      flags: { ...KIND_DECLARATIONS.pages.flags, references: false },
    };
    expect(() => validateKindRequirements(broken)).toThrow(/m06-section-indexer.*requires flag 'references'/);
    // Injection alone carries no such requirement (plans select it with references = false).
    const injectionOnly: KindDeclaration = { ...broken, reactions: ['m06-anchor-injection'] };
    expect(() => validateKindRequirements(injectionOnly)).not.toThrow();
  });

  it('every kind declared in this release passes its own requirements', () => {
    for (const decl of Object.values(KIND_DECLARATIONS)) expect(() => validateKindRequirements(decl)).not.toThrow();
  });

  it('a kind selecting a reaction nobody defined is refused', () => {
    const decl: KindDeclaration = { ...KIND_DECLARATIONS.briefs, reactions: ['m99-nonexistent'] };
    expect(() => validateKindRequirements(decl)).toThrow(/unknown reaction 'm99-nonexistent'/);
  });
});

describe('2.1.8 — bindReaction', () => {
  it('binding an unknown reaction id is fail-fast', () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    w.mountSource({ source: 'pages:pages', dir: tmp() });
    const binder = new ReactionBinder(w, coreCtx([]));
    expect(() => binder.bindReaction('m99-nonexistent', 'pages:pages', 'pages', { rootId: 'pages' })).toThrow(/unknown reaction/);
  });

  it('binding to an unmounted source is fail-fast', () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    const binder = new ReactionBinder(w, coreCtx([]));
    expect(() => binder.bindReaction('m02-file-changed', 'pages:pages', 'pages', { rootId: 'pages' })).toThrow(/unmounted source/);
  });

  it('a definition id may not be a phase name, nor defined twice', () => {
    expect(() => defineReaction({ id: 'capture', phase: 'capture', accepts: ['markdown'], factory: () => NOOP })).toThrow(
      /phase name/,
    );
    expect(() =>
      defineReaction({ id: 'm17-capture', phase: 'capture', accepts: ['markdown'], factory: () => NOOP }),
    ).toThrow(/duplicate/);
  });

  it('[ac:ac-after-wskazujacy-definicje-reakcji-ni] `after` naming a definition not bound on the source does not block the reaction', async () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    const dir = tmp();
    w.mountSource({ source: 'pages:pages', dir });
    // The predecessor IS bound in this context — but on another source: `after`
    // is resolved per source, so it does not hold the reaction on 'pages:pages'.
    w.mountSource({ source: 'pages:adr', dir: tmp() });
    const ran: string[] = [];
    // m14-link-indexer declares `after: ['m06-section-indexer']`; bind it ALONE on 'pages:pages'.
    const ctx = {
      ...coreCtx([]),
      linkIndexer: { onChange: (_s: unknown, src: string) => void ran.push(`m14@${src}`), onUnlink: () => {} },
    } as CoreReactionContext;
    const binder = new ReactionBinder(w, ctx);
    binder.bindReaction('m06-anchor-injection', 'pages:adr', 'pages', { rootId: 'adr' });
    binder.bindReaction('m06-section-indexer', 'pages:adr', 'pages', { rootId: 'adr' });
    binder.bindReaction('m14-link-indexer', 'pages:pages', 'pages', { rootId: 'pages' });
    expect(binder.isBound('m06-section-indexer', 'pages:pages')).toBe(false);
    fs.writeFileSync(path.join(dir, 'a.md'), '# A\n');
    await w.flush('pages:pages', 'a.md');
    expect(ran).toEqual(['m14@pages:pages']);
  });

  it('the binding narrows a source to the formats the reaction accepts', async () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    const dir = tmp();
    w.mountSource({ source: 'pages:pages', dir });
    const ran: string[] = [];
    const ctx = { ...coreCtx([]), sectionIndexer: { onChange: (_s: unknown, _src: string, rel: string) => void ran.push(rel), onUnlink: () => {} } };
    const binder = new ReactionBinder(w, ctx as CoreReactionContext);
    binder.bindReaction('m06-anchor-injection', 'pages:pages', 'pages', { rootId: 'pages' });
    binder.bindReaction('m06-section-indexer', 'pages:pages', 'pages', { rootId: 'pages' });
    fs.writeFileSync(path.join(dir, 'a.md'), '# A\n');
    fs.writeFileSync(path.join(dir, 'b.html'), '<p>b</p>');
    await w.flush('pages:pages', 'a.md');
    await w.flush('pages:pages', 'b.html');
    expect(ran).toEqual(['a.md']);
    expect(binder.isBound('m06-section-indexer', 'pages:pages')).toBe(true);
    expect(binder.isBound('m14-rename-sync', 'pages:pages')).toBe(false);
  });
});

describe('2.1.8 — page reactions as named definitions (M08 j5vqicfm, M14 1z2653we, M17 yg8keaew)', () => {
  it('M14 declares m14-link-indexer (projection after m06-section-indexer) and m14-rename-sync (write-back), both markdown with no requirements', () => {
    const m14 = ['m14-link-indexer', 'm14-rename-sync'];
    // No requirements: a kind selecting only the two M14 reactions, with every flag off, passes.
    const decl: KindDeclaration = {
      ...KIND_DECLARATIONS.pages,
      reactions: m14,
      flags: { release: false, references: false, gitignore: false, agentDirectFs: false },
    };
    expect(() => validateKindRequirements(decl)).not.toThrow();
    for (const id of m14) expect(KIND_DECLARATIONS.pages.reactions).toContain(id);
    // Both bind by id on a pages source.
    const r = runtime();
    const w = r.scoped('context:p1');
    w.mountSource({ source: 'pages:pages', dir: tmp() });
    const binder = new ReactionBinder(w, coreCtx([]));
    for (const id of m14) binder.bindReaction(id, 'pages:pages', 'pages', { rootId: 'pages' });
    for (const id of m14) expect(binder.isBound(id, 'pages:pages')).toBe(true);
  });

  it('M08 declares m08-todos-indexer: a markdown projection with no requirements, bound by kind', async () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    const dir = tmp();
    w.mountSource({ source: 'pages:pages', dir });
    const ran: string[] = [];
    const ctx = { ...coreCtx([]), todosIndexer: { onChange: (_s: unknown, _src: string, rel: string) => void ran.push(rel), onUnlink: () => {} } };
    const binder = new ReactionBinder(w, ctx as CoreReactionContext);
    expect(() =>
      validateKindRequirements({ ...KIND_DECLARATIONS.pages, reactions: ['m08-todos-indexer'], flags: { release: false, references: false, gitignore: false, agentDirectFs: false } }),
    ).not.toThrow();
    binder.bindReaction('m08-todos-indexer', 'pages:pages', 'pages', { rootId: 'pages' });
    fs.writeFileSync(path.join(dir, 'a.md'), '<todo/>\n');
    fs.writeFileSync(path.join(dir, 'b.html'), '<p>b</p>');
    await w.flush('pages:pages', 'a.md');
    await w.flush('pages:pages', 'b.html');
    expect(ran).toEqual(['a.md']);
    expect(binder.isBound('m08-todos-indexer', 'pages:pages')).toBe(true);
  });

  it('m17-capture accepts only `file_version`-track entries: a `.html` file in a pages root is skipped', async () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    const dir = tmp();
    w.mountSource({ source: 'pages:pages', dir });
    const captured: string[] = [];
    const ctx = { ...coreCtx([]), versionCapture: { onChange: (_s: unknown, _src: string, rel: string) => void captured.push(rel), onUnlink: () => {} } };
    const binder = new ReactionBinder(w, ctx as CoreReactionContext);
    binder.bindReaction('m17-capture', 'pages:pages', 'pages', { rootId: 'pages' });
    fs.writeFileSync(path.join(dir, 'a.md'), '# A\n');
    fs.writeFileSync(path.join(dir, 'b.mdx'), '# B\n');
    fs.writeFileSync(path.join(dir, 'c.html'), '<p>c</p>');
    await w.flush('pages:pages', 'a.md');
    await w.flush('pages:pages', 'b.mdx');
    await w.flush('pages:pages', 'c.html');
    expect(captured).toEqual(['a.md', 'b.mdx']);
  });

  it('[ac:ac-plik-html-w-korzeniu-stron-bez-file-version] a change to a `.html` file in a pages-kind root writes no file_version row, while a markdown change does', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    try {
      const r = runtime();
      const w = r.scoped('context:p1');
      const cwd = tmp();
      fs.mkdirSync(path.join(cwd, 'pages'));
      w.mountSource({ source: 'pages:pages', dir: path.join(cwd, 'pages') });
      const serializer = new FileSerializer(new MarkdownFileStore({ cwd, dir: 'pages', rootId: 'pages' }));
      const capture = new FileVersionCapture(
        new FileVersionService(db, serializer),
        new Map([['pages', serializer]]),
        () => undefined,
      );
      const binder = new ReactionBinder(w, { ...coreCtx([]), versionCapture: capture });
      // Bound exactly as the registry loop binds it for a root of kind `pages`.
      expect(KIND_DECLARATIONS.pages.reactions).toContain('m17-capture');
      binder.bindReaction('m17-capture', 'pages:pages', 'pages', { rootId: 'pages' });

      fs.writeFileSync(path.join(cwd, 'pages', 'a.md'), '# A\n');
      fs.writeFileSync(path.join(cwd, 'pages', 'mock.html'), '<p>v1</p>');
      await w.flush('pages:pages', 'a.md');
      await w.flush('pages:pages', 'mock.html');
      fs.writeFileSync(path.join(cwd, 'pages', 'mock.html'), '<p>v2</p>');
      await w.flush('pages:pages', 'mock.html', 'change');
      fs.rmSync(path.join(cwd, 'pages', 'mock.html'));
      await w.flush('pages:pages', 'mock.html', 'unlink');

      const rows = db.prepare(`SELECT rootId, path, op FROM file_version ORDER BY id`).all();
      expect(rows).toEqual([{ rootId: 'pages', path: 'a.md', op: 'create' }]);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM file_version WHERE path LIKE '%.html'`).get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it('the binding hands M06, M08, M14 and M17 the registry entry id as their input rootId (o8crf4hk, j5vqicfm, 1z2653we, yg8keaew)', async () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    const dir = tmp();
    w.mountSource({ source: 'pages:adr', dir });
    const seen: string[] = [];
    const rec = (name: string) => ({
      onChange: (_s: unknown, _src: string, _rel: string, _o: unknown, input: { rootId: string }) =>
        void seen.push(`${name}:${input.rootId}`),
      onUnlink: () => {},
    });
    const ctx = {
      ...coreCtx([]),
      anchorInjectionFor: () => rec('m06-anchor-injection'),
      sectionIndexer: rec('m06-section-indexer'),
      todosIndexer: rec('m08-todos-indexer'),
      linkIndexer: rec('m14-link-indexer'),
      versionCapture: rec('m17-capture'),
    } as unknown as CoreReactionContext;
    const binder = new ReactionBinder(w, ctx);
    // The id the implementor passes, not the one a source name would spell.
    for (const id of ['m06-anchor-injection', 'm06-section-indexer', 'm08-todos-indexer', 'm14-link-indexer', 'm17-capture']) {
      binder.bindReaction(id, 'pages:adr', 'pages', { rootId: 'adr-entry' });
    }
    fs.writeFileSync(path.join(dir, 'a.md'), '# A\n');
    await w.flush('pages:adr', 'a.md');
    expect([...seen].sort()).toEqual(
      ['m06-anchor-injection', 'm06-section-indexer', 'm08-todos-indexer', 'm14-link-indexer', 'm17-capture'].map(
        (id) => `${id}:adr-entry`,
      ),
    );
  });

  it('m17-capture cannot be bound on a kind with no `file_version` entry', () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    w.mountSource({ source: ENTITIES_SOURCE, dir: tmp() });
    const binder = new ReactionBinder(w, coreCtx([]));
    expect(() => binder.bindReaction('m17-capture', ENTITIES_SOURCE, 'entities', { rootId: 'entities' })).toThrow(/m17-capture/);
  });
});

describe('2.1.8 — the base reaction m02-file-changed', () => {
  it('[ac:ac-zmiana-pliku-w-dowolnym-korzeniu-reje] a change in ANY registry root — entities and releases included — emits file:changed with that root id', async () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    const events: WsEvent[] = [];
    const binder = new ReactionBinder(w, coreCtx(events));
    const sources: Array<[string, 'pages' | 'entities' | 'releases' | 'briefs', string, string]> = [
      [pageSource('adr'), 'pages', 'x.md', 'adr'],
      [ENTITIES_SOURCE, 'entities', 'endpoint/a.json', 'entities'],
      [RELEASES_SOURCE, 'releases', 'v1.json', 'releases'],
      ['artifacts:brief', 'briefs', 'b.md', 'briefs'],
    ];
    for (const [source, kind, rel, rootId] of sources) {
      const dir = tmp();
      w.mountSource({ source, dir });
      binder.bindReaction('m02-file-changed', source, kind, { rootId });
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), rel.endsWith('.json') ? '{}' : '# x\n');
      await w.flush(source, rel);
    }
    const changed = events.filter((e) => e.kind === 'file:changed') as Array<Extract<WsEvent, { kind: 'file:changed' }>>;
    expect(changed.map((e) => [e.rootId, e.path])).toEqual([
      ['adr', 'x.md'],
      ['entities', 'endpoint/a.json'],
      ['releases', 'v1.json'],
      ['briefs', 'b.md'],
    ]);
  });
});

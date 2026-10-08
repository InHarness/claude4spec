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
    expect(() => binder.bindReaction('m99-nonexistent', 'pages:pages', 'pages')).toThrow(/unknown reaction/);
  });

  it('binding to an unmounted source is fail-fast', () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    const binder = new ReactionBinder(w, coreCtx([]));
    expect(() => binder.bindReaction('m02-file-changed', 'pages:pages', 'pages')).toThrow(/unmounted source/);
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
    binder.bindReaction('m06-anchor-injection', 'pages:adr', 'pages');
    binder.bindReaction('m06-section-indexer', 'pages:adr', 'pages');
    binder.bindReaction('m14-link-indexer', 'pages:pages', 'pages');
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
    binder.bindReaction('m06-anchor-injection', 'pages:pages', 'pages');
    binder.bindReaction('m06-section-indexer', 'pages:pages', 'pages');
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
    for (const id of m14) binder.bindReaction(id, 'pages:pages', 'pages');
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
    binder.bindReaction('m08-todos-indexer', 'pages:pages', 'pages');
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
    binder.bindReaction('m17-capture', 'pages:pages', 'pages');
    fs.writeFileSync(path.join(dir, 'a.md'), '# A\n');
    fs.writeFileSync(path.join(dir, 'b.mdx'), '# B\n');
    fs.writeFileSync(path.join(dir, 'c.html'), '<p>c</p>');
    await w.flush('pages:pages', 'a.md');
    await w.flush('pages:pages', 'b.mdx');
    await w.flush('pages:pages', 'c.html');
    expect(captured).toEqual(['a.md', 'b.mdx']);
  });

  it('m17-capture cannot be bound on a kind with no `file_version` entry', () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    w.mountSource({ source: ENTITIES_SOURCE, dir: tmp() });
    const binder = new ReactionBinder(w, coreCtx([]));
    expect(() => binder.bindReaction('m17-capture', ENTITIES_SOURCE, 'entities')).toThrow(/m17-capture/);
  });
});

describe('2.1.8 — the base reaction m02-file-changed', () => {
  it('[ac:ac-zmiana-pliku-w-dowolnym-korzeniu-reje] a change in ANY registry root — entities and releases included — emits file:changed with that root id', async () => {
    const r = runtime();
    const w = r.scoped('context:p1');
    const events: WsEvent[] = [];
    const binder = new ReactionBinder(w, coreCtx(events));
    const sources: Array<[string, 'pages' | 'entities' | 'releases' | 'briefs', string]> = [
      [pageSource('adr'), 'pages', 'x.md'],
      [ENTITIES_SOURCE, 'entities', 'endpoint/a.json'],
      [RELEASES_SOURCE, 'releases', 'v1.json'],
      ['artifacts:brief', 'briefs', 'b.md'],
    ];
    for (const [source, kind, rel] of sources) {
      const dir = tmp();
      w.mountSource({ source, dir });
      binder.bindReaction('m02-file-changed', source, kind);
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

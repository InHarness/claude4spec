import { describe, it, expect, beforeEach } from 'vitest';
import { TodosIndexerService } from './todos-indexer.js';
import type { PagesService } from './pages.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { WatchScope } from '../fs/watcher.js';

const scope = {} as WatchScope;

function fakeRoot(files: Record<string, string>): PagesService {
  return {
    async read(rel: string) {
      if (!(rel in files)) throw new Error('ENOENT');
      return { body: files[rel] };
    },
    async listMarkdownFiles() {
      return Object.keys(files);
    },
  } as unknown as PagesService;
}

describe('TodosIndexerService', () => {
  let events: unknown[];
  let ws: WsEmitter;
  let pagesFiles: Record<string, string>;
  let draftsFiles: Record<string, string>;
  let indexer: TodosIndexerService;

  beforeEach(() => {
    events = [];
    ws = { broadcast: (e: unknown) => events.push(e) } as unknown as WsEmitter;
    pagesFiles = {};
    draftsFiles = {};
    indexer = new TodosIndexerService(
      new Map([
        ['pages', fakeRoot(pagesFiles)],
        ['drafts', fakeRoot(draftsFiles)],
      ]),
      ws,
    );
  });

  it('anchors by line, adding the column only for a colliding marker', async () => {
    pagesFiles['a.md'] = [
      'l1', 'l2', 'l3', 'l4',
      '<todo comment="five"/>',
      'l6',
      'x <todo comment="seven a"/> y <todo comment="seven b"/>',
    ].join('\n');
    await indexer.onChange(scope, 'pages:pages', 'a.md');
    const hits = indexer.listByPath('pages', 'a.md');
    expect(hits.map((h) => h.anchor)).toEqual(['todo-5', 'todo-7', `todo-7-${hits[2]!.col}`]);
    expect(hits[2]!.col).toBeGreaterThan(hits[1]!.col);
  });

  it('keeps an empty comment and decodes an escaped quote', async () => {
    pagesFiles['a.md'] = '<todo comment=""/>\n<todo comment="say &quot;hi&quot;"/>';
    await indexer.onChange(scope, 'pages:pages', 'a.md');
    expect(indexer.listByPath('pages', 'a.md').map((h) => h.comment)).toEqual(['', 'say "hi"']);
  });

  it('broadcasts only when the hits change', async () => {
    pagesFiles['a.md'] = '<todo comment="x"/>';
    await indexer.onChange(scope, 'pages:pages', 'a.md');
    expect(events).toEqual([{ kind: 'todos:changed', rootId: 'pages', pagePath: 'a.md' }]);

    pagesFiles['a.md'] = '<todo comment="x"/>\n\nprose edit elsewhere';
    await indexer.onChange(scope, 'pages:pages', 'a.md');
    pagesFiles['b.md'] = 'no markers';
    await indexer.onChange(scope, 'pages:pages', 'b.md');
    expect(events).toHaveLength(1);
  });

  it('onUnlink drops the page and broadcasts', async () => {
    pagesFiles['a.md'] = '<todo comment="x"/>';
    await indexer.onChange(scope, 'pages:pages', 'a.md');
    indexer.onUnlink(scope, 'pages:pages', 'a.md');
    expect(indexer.listAll()).toEqual([]);
    expect(indexer.countTotal()).toBe(0);
    expect(events.at(-1)).toEqual({ kind: 'todos:changed', rootId: 'pages', pagePath: 'a.md' });
  });

  it('[ac:ac-ten-sam-plik-obecny-w-dwoch-rootach-m] counts the same relPath in two roots independently', async () => {
    pagesFiles['same.md'] = '<todo comment="a"/>';
    draftsFiles['same.md'] = '<todo comment="b"/> <todo comment="c"/>';
    await indexer.indexAll();
    expect(indexer.countByPath()).toEqual({ 'pages:same.md': 1, 'drafts:same.md': 2 });
    expect(indexer.countTotal()).toBe(3);
    expect(events).toEqual([]); // full rebuild is silent

    indexer.onUnlink(scope, 'pages:drafts', 'same.md');
    expect(indexer.countByPath()).toEqual({ 'pages:same.md': 1 });
    expect(events).toEqual([{ kind: 'todos:changed', rootId: 'drafts', pagePath: 'same.md' }]);
  });

  it('ignores markers inside code blocks', async () => {
    pagesFiles['a.md'] = '```\n<todo comment="not me"/>\n```\n<todo comment="me"/>';
    await indexer.onChange(scope, 'pages:pages', 'a.md');
    expect(indexer.listByPath('pages', 'a.md').map((h) => h.comment)).toEqual(['me']);
  });
});

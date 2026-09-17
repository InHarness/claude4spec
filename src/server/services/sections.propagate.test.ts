import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { SectionsService, rewritePageLinkAnchor } from './sections.js';
import { PagesService } from './pages.js';
import { FileWatchRuntime, type WatchScope } from '../fs/watcher.js';
import { RecordStore } from '../fs/record-store.js';
import { markdownAdapter, type MarkdownRecord } from '../fs/record-adapters.js';
import { boundWriter } from '../fs/sources.js';
import { registerExtensionReferenceType } from '../../shared/reference-extensions.js';

// Process-level, as `project-context.ts` does it at import — without a registered
// `section_ref` the XML parser does not see the tag at all.
registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor'] });

/**
 * 0.2.89 — M06 → M42. A changed anchor reaches every file that cites it, and each
 * of those files gets its OWN full write sequence on its own path, with the file
 * event suppressed — a bulk rewrite that came back through the watcher would be a
 * cascade of indexing passes, one per touched file.
 */
const SCOPE: WatchScope = 'context:anchor-propagation';
const SOURCE = 'pages:pages';

describe('SectionsService.propagateAnchorChange', () => {
  let cwd: string;
  let pages: PagesService;
  let runtime: FileWatchRuntime;
  let sections: SectionsService;
  let chains: string[];

  beforeEach(async () => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-anchor-propagation-'));
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    runtime = new FileWatchRuntime({ fsEvents: false });
    runtime.mountSource({ source: SOURCE, dir: pages.root, scope: SCOPE });
    const registrar = runtime.scoped(SCOPE);
    pages.records = new RecordStore<MarkdownRecord>({
      registrar,
      source: SOURCE,
      dir: pages.root,
      adapter: markdownAdapter,
    });
    chains = [];
    runtime.subscribe(
      SOURCE,
      { onChange: (_s, _src, relPath) => void chains.push(relPath), onUnlink: () => {} },
      { id: 'm06-section-indexer', phase: 'projection', scope: SCOPE },
    );
    sections = new SectionsService(createTestDb());
    sections.setWriteDeps(new Map([['pages', { pages, watcher: boundWriter(registrar, SOURCE) }]]));
  });

  afterEach(async () => {
    await runtime.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function write(rel: string, body: string): void {
    fs.writeFileSync(path.join(pages.root, rel), body, 'utf-8');
  }

  it('rewrites every citing file through its own chain, and the watcher echo is swallowed', async () => {
    write('one.md', '# One\n\nsee <section_ref anchor="oldanch1"/>\n');
    write('two.md', '# Two\n\n<section_ref anchor="oldanch1"/> and again <section_ref anchor="oldanch1"/>\n');
    write('other.md', '# Other\n\n<section_ref anchor="keepme12"/>\n');

    const { changed } = await sections.propagateAnchorChange('oldanch1', 'newanch1');

    expect(changed.sort()).toEqual(['pages:one.md', 'pages:two.md']);
    expect(fs.readFileSync(path.join(pages.root, 'two.md'), 'utf-8')).not.toContain('oldanch1');
    expect(fs.readFileSync(path.join(pages.root, 'other.md'), 'utf-8')).toContain('keepme12');
    // One chain per touched file, each on its own path — not one collective write.
    expect(chains.sort()).toEqual(['one.md', 'two.md']);

    // The file event each write produced arrives later; it must not start a second pass.
    await runtime.flush(SCOPE, SOURCE, 'one.md');
    await runtime.flush(SCOPE, SOURCE, 'two.md');
    expect(chains.sort()).toEqual(['one.md', 'two.md']);
  });

  it('is a no-op when the anchor did not change', async () => {
    write('one.md', 'see <section_ref anchor="oldanch1"/>\n');
    expect(await sections.propagateAnchorChange('oldanch1', 'oldanch1')).toEqual({ changed: [] });
    expect(chains).toEqual([]);
  });

  it('moves the #anchor suffix of page links together with the tag', async () => {
    write('one.md', '# One\n\nsee @a.md#oldanch1 and [x](a.md#oldanch1)\n');

    const { changed } = await sections.propagateAnchorChange('oldanch1', 'newanch1');

    expect(changed).toEqual(['pages:one.md']);
    expect(fs.readFileSync(path.join(pages.root, 'one.md'), 'utf-8')).toContain(
      'see @a.md#newanch1 and [x](a.md#newanch1)',
    );
  });
});

describe('rewritePageLinkAnchor', () => {
  it('rewrites all three spellings and leaves a longer anchor, a bare hash and fenced code alone', () => {
    const src = [
      '@a.md#oldanch1 `b.md#oldanch1` [c](c.md#oldanch1)',
      '@a.md#oldanch1xyz and #oldanch1 alone',
      '```',
      '@a.md#oldanch1',
      '```',
      '',
    ].join('\n');
    expect(rewritePageLinkAnchor(src, 'oldanch1', 'newanch1')).toBe(
      [
        '@a.md#newanch1 `b.md#newanch1` [c](c.md#newanch1)',
        '@a.md#oldanch1xyz and #oldanch1 alone',
        '```',
        '@a.md#oldanch1',
        '```',
        '',
      ].join('\n'),
    );
  });
});

/**
 * 0.2.46 — the emission discipline of the section index.
 *
 * `section_index` materializes each section's content in `body`. That changed
 * where the content LIVES; it deliberately did not change who may hand it out.
 * These cases pin the read side of that rule at the service every generic read
 * of the index goes through: a bounded `contentSnippet` comes out, the column
 * itself never does.
 */

import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { SECTION_CONTENT_SNIPPET_CHARS, SectionsService } from './sections.js';

describe('SectionsService — what a generic read of the index emits', () => {
  let db: Database.Database;
  let sections: SectionsService;

  function insert(anchor: string, pagePath: string, heading: string, body: string, lineStart = 1): void {
    db.prepare(
      `INSERT INTO section_index
         (rootId, anchor, page_path, heading_path, heading_slug, heading_level, heading_text,
          content_hash, body, line_start, line_end, paragraph_count)
       VALUES ('pages', ?, ?, ?, ?, 2, ?, 'hash', ?, ?, ?, 1)`,
    ).run(anchor, pagePath, heading, heading.toLowerCase(), heading, body, lineStart, lineStart + 4);
  }

  beforeEach(() => {
    db = createTestDb();
    sections = new SectionsService(db);
  });

  afterEach(() => db.close());

  it('emits a snippet that is a prefix of the stored body', async () => {
    insert('aaaa1111', 'notes.md', 'Alpha', 'ALPHA BODY, as authored, with **markdown** intact.');

    const [entry] = sections.list();

    expect(entry!.contentSnippet).toBe('ALPHA BODY, as authored, with **markdown** intact.');
  });

  it('never emits the column itself, however long the body is', async () => {
    insert('aaaa1111', 'notes.md', 'Alpha', 'x'.repeat(SECTION_CONTENT_SNIPPET_CHARS * 4));

    const [entry] = sections.list();

    // `body` is index state; `contentSnippet` is the read contract. A key check,
    // not a value check: the point is that the column has no way out of here.
    expect(Object.keys(entry!)).not.toContain('body');
    expect(entry!.contentSnippet).toHaveLength(SECTION_CONTENT_SNIPPET_CHARS);
    expect(entry!.contentSnippet.startsWith('x')).toBe(true);
  });

  it('cuts at the same width on every generic read, not just the list', async () => {
    const long = 'y'.repeat(SECTION_CONTENT_SNIPPET_CHARS * 2);
    insert('aaaa1111', 'notes.md', 'Alpha', long);

    for (const entry of [sections.list()[0], sections.listByPage('notes.md')[0], sections.getByAnchor('aaaa1111')]) {
      expect(entry!.contentSnippet).toHaveLength(SECTION_CONTENT_SNIPPET_CHARS);
      expect(Object.keys(entry!)).not.toContain('body');
    }
  });

  it('leaves a short body whole and an empty one empty', async () => {
    insert('aaaa1111', 'notes.md', 'Alpha', 'short');
    // A heading with no content is a real section with a real anchor — the
    // collection of a page's sections is not sparse.
    insert('bbbb2222', 'notes.md', 'Empty', '', 10);

    const byAnchor = Object.fromEntries(sections.list().map((s) => [s.anchor, s.contentSnippet]));

    expect(byAnchor['aaaa1111']).toBe('short');
    expect(byAnchor['bbbb2222']).toBe('');
  });

  it('filters by page without touching what it emits', async () => {
    insert('aaaa1111', 'notes.md', 'Alpha', 'from notes');
    insert('bbbb2222', 'other.md', 'Beta', 'from other');

    const scoped = sections.list({ pagePath: 'notes.md' });

    expect(scoped.map((s) => s.anchor)).toEqual(['aaaa1111']);
    expect(scoped[0]!.contentSnippet).toBe('from notes');
  });
});

import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { applyPageWriteToCache, pageWritePayload } from './usePage.js';

/**
 * What a successful page write leaves in the cache, now that the server answers
 * with a delta instead of the page.
 */
describe('applyPageWriteToCache', () => {
  const KEY = ['page', 'pages', 'a.md'];

  it('seeds the cached body from what the client SENT, not from the server', () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, { path: 'a.md', frontmatter: {}, body: 'old' });

    applyPageWriteToCache(qc, { rootId: 'pages', path: 'a.md', body: '# New\n\nbody' });

    expect(qc.getQueryData(KEY)).toEqual({ path: 'a.md', frontmatter: {}, body: '# New\n\nbody' });
  });

  it('leaves the page query VALID, because a refetch would not return those bytes', () => {
    /**
     * The regression this pins. Invalidating looks equivalent and is not: the
     * refetched body is `matter(fileOnDisk).content`, which differs from what
     * was sent — `matter.stringify` leaves a trailing newline on a frontmattered
     * page, and the write-back phase injects anchor comments for new headings.
     *
     * `Editor` recognises the echo of its own write by comparing against exactly
     * the string it saved. A body that came back normalized misses that guard,
     * falls through to `setContent`, and rebuilds the ProseMirror document —
     * so the caret jumps on every autosave, and a keystroke landing in the
     * window before `isDirtyRef` is re-read is dropped outright.
     */
    const qc = new QueryClient();
    qc.setQueryData(KEY, { path: 'a.md', frontmatter: { order: 1 }, body: 'old' });

    applyPageWriteToCache(qc, { rootId: 'pages', path: 'a.md', body: 'typed' });

    expect(qc.getQueryState(KEY)?.isInvalidated).toBeFalsy();
  });

  it('replaces frontmatter when the write carried one, and keeps it when it did not', () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, { path: 'a.md', frontmatter: { order: 1 }, body: 'old' });

    applyPageWriteToCache(qc, { rootId: 'pages', path: 'a.md', body: 'x' });
    expect((qc.getQueryData(KEY) as { frontmatter: unknown }).frontmatter).toEqual({ order: 1 });

    applyPageWriteToCache(qc, { rootId: 'pages', path: 'a.md', body: 'x', frontmatter: { order: 2 } });
    expect((qc.getQueryData(KEY) as { frontmatter: unknown }).frontmatter).toEqual({ order: 2 });
  });

  it('does not fabricate a cache entry for a page nobody has read', () => {
    // A create-then-navigate flow has no entry yet; the mount's own fetch fills
    // it. Writing a partial one here would hand the editor a page with no
    // frontmatter it never actually read.
    const qc = new QueryClient();
    applyPageWriteToCache(qc, { rootId: 'pages', path: 'fresh.md', body: 'x' });
    expect(qc.getQueryData(['page', 'pages', 'fresh.md'])).toBeUndefined();
  });

  it('still invalidates the page LIST, which a new page has to appear in', () => {
    const qc = new QueryClient();
    qc.setQueryData(['pages', 'pages'], []);
    applyPageWriteToCache(qc, { rootId: 'pages', path: 'a.md', body: 'x' });
    expect(qc.getQueryState(['pages', 'pages'])?.isInvalidated).toBe(true);
  });
});

describe('pageWritePayload — a page whose header does not parse (2.1.9, M52)', () => {
  it('[ac:m52-invalid-frontmatter-package-editable] the editor saves a page with a broken header by sending the literal block in front of its body, with no frontmatter object — and the cache keeps the body alone', () => {
    const block = '---\ntitle: "Reviewer\n---\n';
    expect(pageWritePayload({ body: '# Reviewer\n\nNew text.\n', frontmatter: {}, frontmatterRaw: block })).toEqual({
      body: `${block}# Reviewer\n\nNew text.\n`,
      frontmatter: undefined,
    });
    // A page whose header parses is sent as before.
    expect(pageWritePayload({ body: 'b', frontmatter: { title: 'T' } })).toEqual({ body: 'b', frontmatter: { title: 'T' } });

    const qc = new QueryClient();
    const KEY = ['page', 'skills', 'reviewer/SKILL.md'];
    qc.setQueryData(KEY, { path: 'reviewer/SKILL.md', frontmatter: {}, body: 'old', frontmatterRaw: block, hash: 'h0' });
    applyPageWriteToCache(qc, { rootId: 'skills', path: 'reviewer/SKILL.md', body: 'typed', frontmatter: {}, frontmatterRaw: block });
    // The editor's echo guard compares against the body it saved, so the block must not leak into it.
    expect(qc.getQueryData(KEY)).toMatchObject({ body: 'typed', frontmatterRaw: block });
  });
});

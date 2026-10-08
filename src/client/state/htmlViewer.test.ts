import { describe, it, expect, beforeEach } from 'vitest';
import { htmlRevisionKey, isHtmlPreviewPath, useHtmlViewerStore } from './htmlViewer.js';

/**
 * 2.1.8 (M30 `8ya40xzg`): the open `.html` preview reloads on the BASE
 * `file:changed`, narrowed to paths that are the raw `**\/*.html` entry of the
 * `pages` kind's file map. The narrowing is the client's whole M30 mechanism —
 * the module has no reaction of its own.
 */
describe('M30 html preview refresh on base file:changed (8ya40xzg)', () => {
  beforeEach(() => {
    useHtmlViewerStore.setState({ revisions: {} });
  });

  it('narrows to the raw **/*.html entry of the pages file map', () => {
    expect(isHtmlPreviewPath('mock.html')).toBe(true);
    expect(isHtmlPreviewPath('design/proto/index.html')).toBe(true);
    // Markdown entries of the same map are pages, not previews.
    expect(isHtmlPreviewPath('notes/page.md')).toBe(false);
    expect(isHtmlPreviewPath('notes/page.mdx')).toBe(false);
    // Not an entry of the pages map at all.
    expect(isHtmlPreviewPath('report.htm')).toBe(false);
    expect(isHtmlPreviewPath('data.json')).toBe(false);
  });

  it('bumps the revision of exactly the changed (rootId, path), which re-keys the open iframe', () => {
    const { notifyChanged } = useHtmlViewerStore.getState();
    notifyChanged('pages', 'mock.html');
    notifyChanged('pages', 'mock.html');
    notifyChanged('docs', 'other.html');
    const { revisions } = useHtmlViewerStore.getState();
    expect(revisions[htmlRevisionKey('pages', 'mock.html')]).toBe(2);
    expect(revisions[htmlRevisionKey('docs', 'other.html')]).toBe(1);
    expect(revisions[htmlRevisionKey('docs', 'mock.html')]).toBeUndefined();
  });
});

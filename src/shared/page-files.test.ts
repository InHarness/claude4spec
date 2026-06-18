import { describe, expect, it } from 'vitest';
import { isMarkdownPath, markdownExtension, MARKDOWN_PAGE_EXTENSIONS } from './page-files.js';

describe('page-files', () => {
  it('treats .md and .mdx as markdown, nothing else', () => {
    expect(isMarkdownPath('a/b/foo.md')).toBe(true);
    expect(isMarkdownPath('foo.mdx')).toBe(true);
    expect(isMarkdownPath('foo.html')).toBe(false);
    expect(isMarkdownPath('foo.txt')).toBe(false);
    expect(isMarkdownPath('foo')).toBe(false);
  });

  it('derives the icon extension from the name', () => {
    expect(markdownExtension('guide.md')).toBe('md');
    expect(markdownExtension('guide.mdx')).toBe('mdx');
    expect(markdownExtension('preview.html')).toBeNull();
  });

  it('exposes both markdown extensions', () => {
    expect([...MARKDOWN_PAGE_EXTENSIONS]).toEqual(['.md', '.mdx']);
  });
});

/**
 * Page file-extension classification (M02 `e16qvg1n`). `.md` and `.mdx` are one
 * markdown class — both edited in tiptap, section-indexed (M06), reference-
 * validated (M19) and versioned (M17). `.html` is a read-only preview (M30).
 *
 * The `.md`/`.mdx` distinction is purely an icon affordance derived from the file
 * NAME, never from `fileType` (both map to `fileType='markdown'`).
 */
export const MARKDOWN_PAGE_EXTENSIONS = ['.md', '.mdx'] as const;

/** True when a path/name is a markdown page (`.md` or `.mdx`). */
export function isMarkdownPath(p: string): boolean {
  return MARKDOWN_PAGE_EXTENSIONS.some((ext) => p.endsWith(ext));
}

/** The markdown extension of a name (`'md'` | `'mdx'`), or null if not markdown. */
export function markdownExtension(name: string): 'md' | 'mdx' | null {
  if (name.endsWith('.mdx')) return 'mdx';
  if (name.endsWith('.md')) return 'md';
  return null;
}

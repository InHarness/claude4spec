import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { decodePageRef, remarkPageRefs } from './remark-page-refs.js';

/** 2.1.7 — user messages render through ChatMarkdown; page refs survive the move. */
function refsOf(text: string, paths: string[] = ['docs/a.md', 'b.md']) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkPageRefs, { index: new Set(paths), breaks: true });
  const tree = processor.runSync(processor.parse(text)) as unknown as { children: unknown[] };
  const out: Array<{ ref: ReturnType<typeof decodePageRef>; type: string }> = [];
  const walk = (n: { type: string; url?: string; children?: unknown[] }) => {
    if (n.type === 'link' && n.url) out.push({ ref: decodePageRef(n.url), type: n.type });
    if (n.type === 'break') out.push({ ref: null, type: 'break' });
    (n.children as typeof n[] | undefined)?.forEach(walk);
  };
  walk(tree as never);
  return out;
}

describe('remarkPageRefs — the editor page-ref grammar in chat markdown', () => {
  it('@path is always a ref, resolved or not; not after a word char', () => {
    // The editor's `@` grammar, unchanged: the path stops before a `.`, and the
    // chip resolves an extensionless path against `<path>.md`.
    expect(refsOf('see @docs/a#abcd1234 now').map((r) => r.ref)).toEqual([
      { syntax: 'at', path: 'docs/a', anchor: 'abcd1234' },
    ]);
    expect(refsOf('see @missing').map((r) => r.ref?.path)).toEqual(['missing']);
    // (gfm turns it into a mailto link — but never a page ref)
    expect(refsOf('mail me@b.md').filter((r) => r.ref)).toEqual([]);
  });

  it('`path.md` becomes a ref only when it resolves', () => {
    expect(refsOf('open `b.md` and `nope.md`').map((r) => r.ref)).toEqual([{ syntax: 'backticks', path: 'b.md' }]);
  });

  it('[label](path) becomes a ref only for a resolvable relative target', () => {
    expect(refsOf('[A](docs/a.md) [X](https://x.dev/a.md) [N](nope.md)').map((r) => r.ref)).toEqual([
      { syntax: 'link', path: 'docs/a.md', label: 'A' },
      null,
      null,
    ]);
  });

  it('keeps a newline as a line break', () => {
    expect(refsOf('one\ntwo').map((r) => r.type)).toEqual(['break']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  headingPathOf,
  ownBodyOf,
  parseSections,
  PREAMBLE_KEY,
  subtreeBodyOf,
} from './section-parser.js';

const A = (id: string) => `<!-- anchor: ${id} -->`;

describe('parseSections — preamble', () => {
  it('returns content before the first heading as the ~preamble element, frontmatter excluded', () => {
    const text = ['---', 'title: x', '---', 'intro', '', A('aaaaaaaa'), '## One', 'body'].join('\n');
    const r = parseSections(text, 'md');
    expect(r.frontmatter).toEqual({ range: { start: 1, end: 3 }, raw: '---\ntitle: x\n---' });
    expect(r.preamble).toEqual({ key: PREAMBLE_KEY, kind: 'preamble', range: { start: 4, end: 5 } });
    expect(r.sections).toHaveLength(1);
  });

  it('a page without headings is only a preamble; whitespace-only preamble is null', () => {
    expect(parseSections('just text\nmore', 'md')).toMatchObject({
      preamble: { range: { start: 1, end: 2 } },
      sections: [],
    });
    expect(parseSections('\n\n## H\nx', 'md').preamble).toBeNull();
  });

  it('a YAML syntax error in the frontmatter does not stop section parsing', () => {
    const r = parseSections('---\n: : bad: [\n---\n## H\nx', 'md');
    expect(r.frontmatter?.range).toEqual({ start: 1, end: 3 });
    expect(r.sections.map((s) => s.heading)).toEqual(['H']);
  });
});

describe('parseSections — own body vs subtree', () => {
  const text = [
    A('parent01'), // 1
    '## Parent', // 2
    'own text', // 3
    '', // 4
    A('child001'), // 5
    '### Child', // 6
    'child text', // 7
    A('sibling1'), // 8
    '## Sibling', // 9
    'x', // 10
  ].join('\n');
  const r = parseSections(text, 'md');

  it('ownEndLine stops before the next section of ANY level (its anchor line included)', () => {
    const parent = r.sections[0]!;
    expect(parent).toMatchObject({ anchor: 'parent01', startLine: 1, headingLine: 2, ownEndLine: 4, subtreeEndLine: 7 });
    expect(ownBodyOf(text, parent)).toBe('own text\n');
    expect(subtreeBodyOf(text, parent)).toContain('### Child');
    expect(r.sections[1]).toMatchObject({ anchor: 'child001', startLine: 5, ownEndLine: 7, subtreeEndLine: 7, parent: 0 });
  });

  it('parent/position describe the hierarchy', () => {
    expect(r.sections.map((s) => [s.position, s.parent])).toEqual([[0, null], [1, 0], [2, null]]);
    expect(headingPathOf(r, r.sections[1]!)).toEqual(['Parent']);
  });

  it('on a level jump (## → ####) the #### parent is the ##', () => {
    const j = parseSections('## A\n#### D\n## B', 'md');
    expect(j.sections.map((s) => s.parent)).toEqual([null, 0, null]);
  });
});

describe('parseSections — excluded ranges', () => {
  it('## X inside ``` or ~~~ does not make a section', () => {
    const r = parseSections('## Real\n```\n## Fake\n```\n~~~\n## Fake2\n~~~', 'md');
    expect(r.sections.map((s) => s.heading)).toEqual(['Real']);
    expect(r.excludedRanges).toEqual([
      { kind: 'fence', range: { start: 2, end: 4 } },
      { kind: 'fence', range: { start: 5, end: 7 } },
    ]);
  });

  it('an unclosed block runs to end of document; the heading below it is not a section', () => {
    const r = parseSections('## A\n```\n## B', 'md');
    expect(r.sections.map((s) => s.heading)).toEqual(['A']);
    expect(r.diagnostics.unclosedCodeBlocks).toEqual([{ openLine: 2 }]);
  });

  it('a heading inside a multi-line HTML comment does not open a section; an unclosed comment is reported', () => {
    const r = parseSections('## A\n<!--\n## B\n-->\n## C\n<!-- open\n## D', 'md');
    expect(r.sections.map((s) => s.heading)).toEqual(['A', 'C']);
    expect(r.diagnostics.unclosedCodeBlocks).toEqual([{ openLine: 6 }]);
  });

  it('unknown JSX is an excluded range in .mdx only', () => {
    const text = '<Callout>\n## Inside\n</Callout>\n## Out';
    expect(parseSections(text, 'mdx').sections.map((s) => s.heading)).toEqual(['Out']);
    expect(parseSections(text, 'md').sections.map((s) => s.heading)).toEqual(['Inside', 'Out']);
    expect(parseSections('<br>\n## H', 'mdx').sections).toHaveLength(1);
  });
});

describe('parseSections — anchors', () => {
  it('an anchor-shaped line in a code block is not an anchor, only a diagnostic', () => {
    const text = ['```md', A('incode01'), '## Example', '```', '## Real'].join('\n');
    const r = parseSections(text, 'md');
    expect(r.sections).toEqual([expect.objectContaining({ heading: 'Real', anchor: null })]);
    expect(r.diagnostics.orphanAnchors).toEqual([]);
    expect(r.diagnostics.anchorLinesInCode).toEqual([{ anchor: 'incode01', line: 2, adjacentToHeadingLine: true }]);
  });

  it('a code fence closing right above a heading does not donate its anchor line', () => {
    const r = parseSections(['```', A('incode02'), '```', '## H'].join('\n'), 'md');
    expect(r.sections[0]!.anchor).toBeNull();
    expect(r.diagnostics.anchorLinesInCode[0]!.adjacentToHeadingLine).toBe(false);
  });

  it('classifies orphans: stacked, not-before-heading, end-of-file', () => {
    const text = [A('stacked1'), A('owner001'), '## H', A('prose001'), 'text', A('eofanch1'), ''].join('\n');
    const r = parseSections(text, 'md');
    expect(r.sections[0]).toMatchObject({ anchor: 'owner001', startLine: 1 });
    expect(r.diagnostics.orphanAnchors).toEqual([
      { anchor: 'stacked1', line: 1, reason: 'stacked' },
      { anchor: 'prose001', line: 4, reason: 'not-before-heading' },
      { anchor: 'eofanch1', line: 6, reason: 'end-of-file' },
    ]);
  });

  it('a one-line comment is not an excluded range — the anchor line stays an anchor', () => {
    const r = parseSections([A('abcdefgh'), '## H'].join('\n'), 'md');
    expect(r.excludedRanges).toEqual([]);
    expect(r.sections[0]!.anchor).toBe('abcdefgh');
  });
});

describe('parseSections — totality and determinism', () => {
  it('never throws and is deterministic', () => {
    const inputs = ['', '\n', '#', '###### ', '```', '<!--', '---', '---\n', '> ```\n>', '- ```\n', '\u0000## x'];
    for (const t of inputs) {
      const a = parseSections(t, 'mdx');
      expect(parseSections(t, 'mdx')).toEqual(a);
    }
  });
});

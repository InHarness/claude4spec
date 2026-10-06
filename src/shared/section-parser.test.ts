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
    const r = parseSections(text);
    expect(r.frontmatter).toEqual({ range: { start: 1, end: 3 }, raw: '---\ntitle: x\n---' });
    expect(r.preamble).toEqual({ key: PREAMBLE_KEY, kind: 'preamble', range: { start: 4, end: 5 } });
    expect(r.sections).toHaveLength(1);
  });

  it('a page without headings is only a preamble; whitespace-only preamble is null', () => {
    expect(parseSections('just text\nmore')).toMatchObject({
      preamble: { range: { start: 1, end: 2 } },
      sections: [],
    });
    expect(parseSections('\n\n## H\nx').preamble).toBeNull();
  });

  it('a YAML syntax error in the frontmatter does not stop section parsing', () => {
    const r = parseSections('---\n: : bad: [\n---\n## H\nx');
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
  const r = parseSections(text);

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
    const j = parseSections('## A\n#### D\n## B');
    expect(j.sections.map((s) => s.parent)).toEqual([null, 0, null]);
  });
});

describe('parseSections — excluded ranges', () => {
  it('## X inside ``` or ~~~ does not make a section', () => {
    const r = parseSections('## Real\n```\n## Fake\n```\n~~~\n## Fake2\n~~~');
    expect(r.sections.map((s) => s.heading)).toEqual(['Real']);
    expect(r.excludedRanges).toEqual([
      { kind: 'fence', range: { start: 2, end: 4 } },
      { kind: 'fence', range: { start: 5, end: 7 } },
    ]);
  });

  it('an unclosed block runs to end of document; the heading below it is not a section', () => {
    const r = parseSections('## A\n```\n## B');
    expect(r.sections.map((s) => s.heading)).toEqual(['A']);
    expect(r.diagnostics.unclosedCodeBlocks).toEqual([{ openLine: 2 }]);
  });

  it('a heading inside a multi-line HTML comment does not open a section; an unclosed comment is reported', () => {
    const r = parseSections('## A\n<!--\n## B\n-->\n## C\n<!-- open\n## D');
    expect(r.sections.map((s) => s.heading)).toEqual(['A', 'C']);
    expect(r.diagnostics.unclosedCodeBlocks).toEqual([{ openLine: 6 }]);
  });

  it('fences are recognised in CRLF text', () => {
    const r = parseSections('## Real\r\n```bash\r\n# comment\r\n```\r\n');
    expect(r.sections.map((s) => s.heading)).toEqual(['Real']);
    expect(r.diagnostics.unclosedCodeBlocks).toEqual([]);
  });

  it('2.1.7 — unknown JSX is an excluded range in EVERY file; the extension is not an input', () => {
    const text = '<Callout>\n## Inside\n</Callout>\n## Out';
    const r = parseSections(text);
    expect(r.sections.map((s) => s.heading)).toEqual(['Out']);
    expect(r.excludedRanges.map((e) => e.kind)).toEqual(['jsx']);
    // Lowercase HTML marks no region.
    expect(parseSections('<br>\n## H').sections).toHaveLength(1);
  });
});

describe('parseSections — anchors', () => {
  it('an anchor-shaped line in a code block is not an anchor, only a diagnostic', () => {
    const text = ['```md', A('incode01'), '## Example', '```', '## Real'].join('\n');
    const r = parseSections(text);
    expect(r.sections).toEqual([expect.objectContaining({ heading: 'Real', anchor: null })]);
    expect(r.diagnostics.orphanAnchors).toEqual([]);
    expect(r.diagnostics.anchorLinesInCode).toEqual([{ anchor: 'incode01', line: 2, adjacentToHeadingLine: true }]);
  });

  it('a code fence closing right above a heading does not donate its anchor line', () => {
    const r = parseSections(['```', A('incode02'), '```', '## H'].join('\n'));
    expect(r.sections[0]!.anchor).toBeNull();
    expect(r.diagnostics.anchorLinesInCode[0]!.adjacentToHeadingLine).toBe(false);
  });

  it('classifies orphans: stacked, not-before-heading, end-of-file', () => {
    const text = [A('stacked1'), A('owner001'), '## H', A('prose001'), 'text', A('eofanch1'), ''].join('\n');
    const r = parseSections(text);
    expect(r.sections[0]).toMatchObject({ anchor: 'owner001', startLine: 1 });
    expect(r.diagnostics.orphanAnchors).toEqual([
      { anchor: 'stacked1', line: 1, reason: 'stacked' },
      { anchor: 'prose001', line: 4, reason: 'not-before-heading' },
      { anchor: 'eofanch1', line: 6, reason: 'end-of-file' },
    ]);
  });

  it('a one-line comment is not an excluded range — the anchor line stays an anchor', () => {
    const r = parseSections([A('abcdefgh'), '## H'].join('\n'));
    expect(r.excludedRanges).toEqual([]);
    expect(r.sections[0]!.anchor).toBe('abcdefgh');
  });
});

describe('parseSections — totality and determinism', () => {
  it('never throws and is deterministic', () => {
    const inputs = ['', '\n', '#', '###### ', '```', '<!--', '---', '---\n', '> ```\n>', '- ```\n', '\u0000## x'];
    for (const t of inputs) {
      const a = parseSections(t);
      expect(parseSections(t)).toEqual(a);
    }
  });
});

describe('pageStructure / serializePageStructure (2.1.6)', () => {
  const PAGE = [
    '---',
    'title: T',
    '---',
    'Intro.',
    '',
    A('aaaa0001'),
    '# One',
    '',
    'one body',
    A('aaaa0002'),
    '## Two',
    'two body',
    '### Untagged',
    'tail',
    '',
  ].join('\n');

  it('slices frontmatter, preamble and own bodies literally — concatenation is the file', async () => {
    const { pageStructure } = await import('./section-parser.js');
    const s = pageStructure(PAGE);
    expect(s.frontmatter).toBe('---\ntitle: T\n---\n');
    expect(s.preamble).toBe('Intro.\n\n');
    expect(s.sections).toEqual([
      { anchor: 'aaaa0001', level: 1, heading: 'One', body: '\none body\n' },
      { anchor: 'aaaa0002', level: 2, heading: 'Two', body: 'two body\n' },
      { anchor: null, level: 3, heading: 'Untagged', body: 'tail\n' },
    ]);
  });

  it('round-trips byte for byte on a canonical page', async () => {
    const { pageStructure, serializePageStructure } = await import('./section-parser.js');
    expect(serializePageStructure(pageStructure(PAGE))).toBe(PAGE);
  });

  it('round-trips STRUCTURALLY when anchors are stacked — only the owner returns', async () => {
    const { pageStructure, serializePageStructure } = await import('./section-parser.js');
    const stacked = [A('dead0001'), A('aaaa0001'), '# One', 'x', ''].join('\n');
    const again = pageStructure(serializePageStructure(pageStructure(stacked)));
    expect(again.sections).toEqual(pageStructure(stacked).sections);
    expect(serializePageStructure(pageStructure(stacked))).not.toContain('dead0001');
  });

  it('a page with no heading is all preamble; a blank preamble is null', async () => {
    const { pageStructure } = await import('./section-parser.js');
    expect(pageStructure('just prose\n')).toEqual({ frontmatter: null, preamble: 'just prose\n', sections: [] });
    expect(pageStructure('\n# A\n').preamble).toBeNull();
  });

  it('a heading-only item (a body the budget cut) serializes as anchor + heading', async () => {
    const { serializePageStructure } = await import('./section-parser.js');
    expect(
      serializePageStructure({ sections: [{ anchor: 'aaaa0001', level: 2, heading: 'Two' }, { level: 2, heading: 'Three', body: 'x\n' }] }),
    ).toBe('<!-- anchor: aaaa0001 -->\n## Two\n## Three\nx\n');
  });
});

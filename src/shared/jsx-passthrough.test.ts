import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import {
  isJsxComponentName,
  isPassthroughTag,
  matchJsxTagOpen,
  findJsxSpanEnd,
  findJsxBlockEnd,
  lineCodeSpans,
  jsxBlockRule,
  JSX_BLOCK_RULE_NAME,
} from './jsx-passthrough.js';

describe('JSX-component shape gate', () => {
  it('treats uppercase-initial and dotted names as components', () => {
    expect(isJsxComponentName('Callout')).toBe(true);
    expect(isJsxComponentName('ui.Card')).toBe(true);
    expect(isJsxComponentName('br')).toBe(false);
    expect(isJsxComponentName('strong')).toBe(false);
    expect(isJsxComponentName('inline_mention')).toBe(false);
  });

  it('routes only component-shaped tags outside the registry; never lowercase HTML or registered names', () => {
    expect(isPassthroughTag('Callout')).toBe(true);
    expect(isPassthroughTag('ui.Card')).toBe(true);
    expect(isPassthroughTag('br')).toBe(false); // lowercase HTML stays in pipeline
    expect(isPassthroughTag('img')).toBe(false);
    expect(isPassthroughTag('inline_mention')).toBe(false); // registered tag
    expect(isPassthroughTag('section_ref')).toBe(false); // registered tag
  });
});

describe('matchJsxTagOpen', () => {
  it('matches self-closing and paired opens with attrs', () => {
    expect(matchJsxTagOpen('<Foo/>', 0)).toEqual({ name: 'Foo', selfClosing: true, openEnd: 6 });
    expect(matchJsxTagOpen('<Foo bar="x" />', 0)).toMatchObject({ name: 'Foo', selfClosing: true });
    expect(matchJsxTagOpen('<Callout type="info">', 0)).toEqual({
      name: 'Callout',
      selfClosing: false,
      openEnd: 21,
    });
    expect(matchJsxTagOpen('text <Foo/>', 0)).toBeNull();
  });
});

describe('findJsxSpanEnd (depth-counting by name)', () => {
  it('closes the matching tag, counting nested same-name pairs', () => {
    const t = '<Foo><Foo>x</Foo></Foo>';
    expect(findJsxSpanEnd(t, 0, 'Foo')).toBe(t.length);
  });

  it('ignores self-closing same-name and different-name tags inside', () => {
    const t = '<Foo><Foo/><Bar>y</Bar></Foo>';
    expect(findJsxSpanEnd(t, 0, 'Foo')).toBe(t.length);
  });

  it('returns -1 when unbalanced', () => {
    expect(findJsxSpanEnd('<Foo>no close', 0, 'Foo')).toBe(-1);
  });
});

describe('findJsxSpanEnd limit (inline block bound)', () => {
  it('does not close past the limit', () => {
    const t = '<Foo>a</Foo>';
    expect(findJsxSpanEnd(t, 0, 'Foo', [], 8)).toBe(-1);
    expect(findJsxSpanEnd(t, 0, 'Foo', [], t.length)).toBe(t.length);
  });
});

describe('lineCodeSpans', () => {
  it('pairs runs of equal length, leaves unpaired and escaped runs literal', () => {
    const t = 'a `x` b ``y` z`` \\` c `';
    const spans = lineCodeSpans(t, 0, t.length).map(([s, e]) => t.slice(s, e));
    expect(spans).toEqual(['`x`', '``y` z``']);
  });
});

/** Container lines of a plain document (no container), from line `from`. */
function plainLines(t: string, openStart: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = 0;
  for (const l of t.split('\n')) {
    const e = s + l.length;
    if (e >= openStart) out.push([Math.max(s, openStart), e]);
    s = e + 1;
  }
  return out;
}

describe('findJsxBlockEnd (M51 nesting counter)', () => {
  it('counts same-name nesting by name', () => {
    const t = '<Foo>\n<Foo>\nx\n</Foo>\n</Foo>';
    expect(findJsxBlockEnd(t, 0, 'Foo', plainLines(t, 0))).toEqual({ end: t.length, line: 4 });
  });

  it('skips a closing tag quoted in inline code of its line', () => {
    const t = '<Foo>\nsee `</Foo>` here\n</Foo>';
    expect(findJsxBlockEnd(t, 0, 'Foo', plainLines(t, 0))).toEqual({ end: t.length, line: 2 });
  });

  it('an unpaired opening yields no end', () => {
    const t = '<Foo>\nno close here';
    expect(findJsxBlockEnd(t, 0, 'Foo', plainLines(t, 0))).toBeNull();
  });
});

describe('jsxBlockRule (shared tokenizer config)', () => {
  const md = () => {
    const m = new MarkdownIt({ html: true });
    m.block.ruler.before('html_block', JSX_BLOCK_RULE_NAME, jsxBlockRule({ emit: (raw) => `RAW[${raw}]` }));
    return m;
  };

  it('claims a paired own-line region and carries its exact range', () => {
    const t = 'intro\n\n<Callout>\n\nbody\n</Callout>\nafter\n';
    const tokens = md().parse(t, {});
    const region = tokens.find((tk) => tk.meta && tk.meta.jsxRegion);
    expect(region).toBeDefined();
    const [s, e] = region!.meta.jsxRegion as [number, number];
    expect(t.slice(s, e)).toBe('<Callout>\n\nbody\n</Callout>');
    expect(region!.content).toBe('RAW[<Callout>\n\nbody\n</Callout>]');
  });

  it('declines an unpaired opening and a pair split by a container boundary', () => {
    const unpaired = md().parse('<Callout>\ntext\n', {});
    expect(unpaired.some((tk) => tk.meta && tk.meta.jsxRegion)).toBe(false);
    const split = md().parse('> <Callout>\n> x\n\n</Callout>\n', {});
    expect(split.some((tk) => tk.meta && tk.meta.jsxRegion)).toBe(false);
  });

  it('a tag indented four spaces is an indented code block, not a region', () => {
    const tokens = md().parse('    <Callout>\n    x\n    </Callout>\n', {});
    expect(tokens.some((tk) => tk.meta && tk.meta.jsxRegion)).toBe(false);
    expect(tokens.some((tk) => tk.type === 'code_block')).toBe(true);
  });
});

describe('findJsxBlockEnd — fence indent (CommonMark: at most 3 columns)', () => {
  it('a backtick line indented four columns is content, not a fence: the close after it counts', () => {
    const t = '<Foo>\n    ```\n</Foo>';
    expect(findJsxBlockEnd(t, 0, 'Foo', plainLines(t, 0))).toEqual({ end: t.length, line: 2 });
  });

  it('a fence indented three columns still hides a closing tag inside it', () => {
    const t = '<Foo>\n   ```\n</Foo>\n   ```';
    expect(findJsxBlockEnd(t, 0, 'Foo', plainLines(t, 0))).toBeNull();
  });

  it('a closing fence indented four columns does not close the fence', () => {
    const t = '<Foo>\n```\n    ```\n</Foo>\n```\n</Foo>';
    expect(findJsxBlockEnd(t, 0, 'Foo', plainLines(t, 0))).toEqual({ end: t.length, line: 5 });
  });

  it('measures the indent from the container content (`baseIndent`)', () => {
    const fourPast = '  <Foo>\n      ```\n  </Foo>';
    expect(findJsxBlockEnd(fourPast, 2, 'Foo', plainLines(fourPast, 2), 2)).toEqual({
      end: fourPast.length,
      line: 2,
    });
    const threePast = '  <Foo>\n     ```\n  </Foo>\n     ```';
    expect(findJsxBlockEnd(threePast, 2, 'Foo', plainLines(threePast, 2), 2)).toBeNull();
  });

  it('jsxBlockRule claims a region whose inner backtick line is indented four columns', () => {
    const m = new MarkdownIt({ html: true });
    m.block.ruler.before('html_block', JSX_BLOCK_RULE_NAME, jsxBlockRule());
    const t = '<Callout>\n    ```\n</Callout>\n';
    const region = m.parse(t, {}).find((tk) => tk.meta && tk.meta.jsxRegion);
    expect(region).toBeDefined();
    expect(t.slice(...(region!.meta.jsxRegion as [number, number]))).toBe('<Callout>\n    ```\n</Callout>');
  });
});

describe('jsxBlockRule — linear in the document, behaviour kept', () => {
  const md = () => {
    const m = new MarkdownIt({ html: true });
    m.block.ruler.before('html_block', JSX_BLOCK_RULE_NAME, jsxBlockRule());
    return m;
  };
  const regions = (t: string) =>
    md()
      .parse(t, {})
      .filter((tk) => tk.meta && tk.meta.jsxRegion)
      .map((tk) => t.slice(...(tk.meta.jsxRegion as [number, number])));

  it('many unpaired openings at top level: no region, and no walk to the end per opening', () => {
    const t = '<Callout>\n\n'.repeat(30000);
    const started = Date.now();
    expect(regions(t)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('many paired regions: each one found, each walk stops at its own close', () => {
    const t = '<Callout>\nx\n</Callout>\n\n'.repeat(10000);
    const started = Date.now();
    const found = regions(t);
    expect(found).toHaveLength(10000);
    expect(new Set(found)).toEqual(new Set(['<Callout>\nx\n</Callout>']));
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('an unpaired opening before a later pair stays text; the pair is still a region', () => {
    // From the first opening the count ends at depth 1 (the later pair nests): unpaired.
    expect(regions('<Callout>\ntext\n\n<Callout>\nbody\n</Callout>\n')).toEqual(['<Callout>\nbody\n</Callout>']);
    expect(regions('<Note>\ntext\n\n<Callout>\nbody\n</Callout>\n')).toEqual(['<Callout>\nbody\n</Callout>']);
    expect(regions('<Callout>\n<Callout>\nx\n</Callout>\n</Callout>\n')).toEqual([
      '<Callout>\n<Callout>\nx\n</Callout>\n</Callout>',
    ]);
  });

  it('a self-closing tag alone on its line is still a region', () => {
    expect(regions('<Callout />\n\nafter\n')).toEqual(['<Callout />']);
  });
});

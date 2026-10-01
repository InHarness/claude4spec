import { describe, expect, it } from 'vitest';
import {
  isJsxComponentName,
  isPassthroughTag,
  matchJsxTagOpen,
  findJsxSpanEnd,
  findUnknownJsxRanges,
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

describe('findUnknownJsxRanges', () => {
  it('finds self-closing and paired component tags, skips known/lowercase tags', () => {
    const t = 'a <Icon/> b <Callout>hi</Callout> c <br> <inline_mention type="d" slug="s"/>';
    const ranges = findUnknownJsxRanges(t);
    const spans = ranges.map(([s, e]) => t.slice(s, e));
    expect(spans).toEqual(['<Icon/>', '<Callout>hi</Callout>']);
  });

  it('skips tags inside supplied code ranges', () => {
    const t = '<Icon/> and <Icon/>';
    // pretend the first <Icon/> (offsets 0..7) sits inside a code span
    const ranges = findUnknownJsxRanges(t, [[0, 7]]);
    expect(ranges.map(([s, e]) => t.slice(s, e))).toEqual(['<Icon/>']);
  });

  it('skips unbalanced paired opens rather than over-excluding', () => {
    expect(findUnknownJsxRanges('<Callout>no close here')).toEqual([]);
  });
});

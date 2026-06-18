import { describe, expect, it } from 'vitest';
import { escapeRawAttr, unescapeRawAttr } from './raw-jsx-escape.js';

describe('raw-jsx-escape', () => {
  it('round-trips strings containing & " < > and newlines', () => {
    const samples = [
      '<Callout type="info">Hello & welcome</Callout>',
      '<Foo>\nline1\nline2\n</Foo>',
      'plain text, no specials',
      'a & b < c > d "quoted" e',
      '<ui.Card slug="x"/>\r\n',
      '',
    ];
    for (const s of samples) {
      expect(unescapeRawAttr(escapeRawAttr(s))).toBe(s);
    }
  });

  it('produces an attribute-safe payload (no raw < > " or newline)', () => {
    const escaped = escapeRawAttr('<Foo bar="x">\n</Foo>');
    expect(escaped).not.toMatch(/[<>"\n\r]/);
    expect(escaped).toContain('&lt;');
    expect(escaped).toContain('&quot;');
    expect(escaped).toContain('&#10;');
  });

  it('escapes & first so < does not become &amp;lt;', () => {
    expect(escapeRawAttr('a&b<c')).toBe('a&amp;b&lt;c');
    expect(unescapeRawAttr('a&amp;b&lt;c')).toBe('a&b<c');
  });
});

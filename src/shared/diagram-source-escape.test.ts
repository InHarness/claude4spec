import { describe, expect, it } from 'vitest';
import { escapeDiagramSource, unescapeDiagramSource } from './diagram-source-escape.js';

describe('diagram-source-escape', () => {
  it('roundtrips a source containing every escaped character', () => {
    const source = 'graph TD\r\n  A["x & y < z"] --> B\n  B --> C';
    expect(unescapeDiagramSource(escapeDiagramSource(source))).toBe(source);
  });

  it('escapes & first so pre-escaped input survives the roundtrip', () => {
    const source = 'label: &quot; and &#10; stay literal';
    expect(unescapeDiagramSource(escapeDiagramSource(source))).toBe(source);
  });

  it('produces single-line output for multiline input', () => {
    const escaped = escapeDiagramSource('a\nb\r\nc');
    expect(escaped).not.toMatch(/[\n\r]/);
  });
});

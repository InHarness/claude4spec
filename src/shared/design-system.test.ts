import { describe, expect, it } from 'vitest';
import { resolve, lintTokens } from './design-system.js';
import type { DesignMode, TokenGroup } from './entities.js';

const primitives = (tokens: TokenGroup['tokens']): TokenGroup => ({
  name: 'Primitives',
  tier: 'primitive',
  tokens,
});
const semantics = (tokens: TokenGroup['tokens']): TokenGroup => ({
  name: 'Roles',
  tier: 'semantic',
  tokens,
});

describe('resolve()', () => {
  it('resolves a one-hop alias chain to the literal', () => {
    const groups = [
      primitives([{ name: 'blue-500', type: 'color', value: '#2563eb' }]),
      semantics([{ name: 'color-action', type: 'color', value: '{blue-500}' }]),
    ];
    const r = resolve(groups, []);
    expect(r['color-action']).toBe('#2563eb');
    expect(r['blue-500']).toBe('#2563eb');
  });

  it('resolves a multi-hop alias chain', () => {
    const groups = [
      primitives([{ name: 'a', type: 'color', value: '#fff' }]),
      semantics([
        { name: 'b', type: 'color', value: '{a}' },
        { name: 'c', type: 'color', value: '{b}' },
      ]),
    ];
    expect(resolve(groups, [])['c']).toBe('#fff');
  });

  it('returns "unresolved" for an alias cycle and never throws', () => {
    const groups = [
      semantics([
        { name: 'a', type: 'color', value: '{b}' },
        { name: 'b', type: 'color', value: '{a}' },
      ]),
    ];
    let r: Record<string, unknown> = {};
    expect(() => {
      r = resolve(groups, []);
    }).not.toThrow();
    expect(r['a']).toBe('unresolved');
    expect(r['b']).toBe('unresolved');
  });

  it('returns "unresolved" for an alias to a missing token', () => {
    const groups = [semantics([{ name: 'x', type: 'color', value: '{nope}' }])];
    expect(resolve(groups, [])['x']).toBe('unresolved');
  });

  it('applies active-mode overrides over base; Base = no overrides', () => {
    const groups = [
      primitives([
        { name: 'gray-50', type: 'color', value: '#fafafa' },
        { name: 'gray-900', type: 'color', value: '#111' },
      ]),
      semantics([{ name: 'color-surface', type: 'color', value: '{gray-50}' }]),
    ];
    const modes: DesignMode[] = [
      { name: 'dark', overrides: [{ token: 'color-surface', value: '{gray-900}' }] },
    ];
    expect(resolve(groups, modes)['color-surface']).toBe('#fafafa'); // Base
    expect(resolve(groups, modes, 'dark')['color-surface']).toBe('#111');
  });

  it('ignores an override targeting a non-existent token', () => {
    const groups = [primitives([{ name: 'a', type: 'color', value: '#000' }])];
    const modes: DesignMode[] = [{ name: 'x', overrides: [{ token: 'ghost', value: '#fff' }] }];
    const r = resolve(groups, modes, 'x');
    expect(r['a']).toBe('#000');
    expect(r['ghost']).toBeUndefined();
  });

  it('resolves composite typography fields (literal + alias)', () => {
    const groups = [
      primitives([{ name: 'font-sans', type: 'fontFamily', value: 'Inter' }]),
      semantics([
        {
          name: 'heading-1',
          type: 'typography',
          value: { fontFamily: '{font-sans}', fontSize: '32px', fontWeight: '700' },
        },
      ]),
    ];
    const r = resolve(groups, [])['heading-1'];
    expect(r).toEqual({ fontFamily: 'Inter', fontSize: '32px', fontWeight: '700' });
  });

  it('marks an unresolvable composite field as "unresolved"', () => {
    const groups = [
      semantics([
        { name: 't', type: 'typography', value: { fontFamily: '{missing}', fontSize: '16px' } },
      ]),
    ];
    const r = resolve(groups, [])['t'] as Record<string, string>;
    expect(r.fontFamily).toBe('unresolved');
    expect(r.fontSize).toBe('16px');
  });
});

describe('lintTokens()', () => {
  it('warns on an alias to a non-existent token', () => {
    const w = lintTokens([semantics([{ name: 'x', type: 'color', value: '{nope}' }])], []);
    expect(w.some((m) => m.includes("alias '{nope}'"))).toBe(true);
  });

  it('warns on an alias cycle', () => {
    const w = lintTokens(
      [
        semantics([
          { name: 'a', type: 'color', value: '{b}' },
          { name: 'b', type: 'color', value: '{a}' },
        ]),
      ],
      []
    );
    expect(w.some((m) => m.startsWith('Alias cycle:'))).toBe(true);
  });

  it('warns on a duplicate token name', () => {
    const w = lintTokens(
      [
        primitives([
          { name: 'dup', type: 'color', value: '#000' },
          { name: 'dup', type: 'color', value: '#fff' },
        ]),
      ],
      []
    );
    expect(w.some((m) => m.includes("Duplicate token name 'dup'"))).toBe(true);
  });

  it('warns on a mode override targeting a missing token', () => {
    const w = lintTokens(
      [primitives([{ name: 'a', type: 'color', value: '#000' }])],
      [{ name: 'm', overrides: [{ token: 'ghost', value: '#fff' }] }]
    );
    expect(w.some((m) => m.includes("override targets non-existent token 'ghost'"))).toBe(true);
  });

  it('warns on object value for a non-composite type and string value for a composite type', () => {
    const w = lintTokens(
      [
        primitives([
          { name: 'bad-obj', type: 'color', value: { x: '1' } },
          { name: 'bad-str', type: 'typography', value: '16px' },
        ]),
      ],
      []
    );
    expect(w.some((m) => m.includes("'bad-obj'") && m.includes('composite type'))).toBe(true);
    expect(w.some((m) => m.includes("'bad-str'") && m.includes('composite object value'))).toBe(true);
  });

  it('never throws and returns [] for a clean design system', () => {
    let w: string[] = [];
    expect(() => {
      w = lintTokens(
        [
          primitives([{ name: 'blue', type: 'color', value: '#2563eb' }]),
          semantics([{ name: 'action', type: 'color', value: '{blue}' }]),
        ],
        []
      );
    }).not.toThrow();
    expect(w).toEqual([]);
  });
});

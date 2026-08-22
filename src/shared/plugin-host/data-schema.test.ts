import { describe, expect, it } from 'vitest';
import {
  constraintsOf,
  normalizeFieldValue,
  normalizePayload,
  type FieldNode,
} from './data-schema.js';

const language: FieldNode = {
  type: 'string',
  maxLength: 30,
  normalize: { case: 'lower', aliases: { '': 'text', ts: 'typescript', sh: 'bash' } },
};

describe('normalizeFieldValue', () => {
  it('folds case before consulting the alias table', () => {
    expect(normalizeFieldValue(language, 'TypeScript')).toBe('typescript');
    expect(normalizeFieldValue(language, 'TS')).toBe('typescript');
    expect(normalizeFieldValue(language, 'Sh')).toBe('bash');
  });

  it('passes a value outside the table through, folded, without refusing', () => {
    expect(normalizeFieldValue(language, 'CobOL')).toBe('cobol');
  });

  it('maps the empty string to the default via the table', () => {
    expect(normalizeFieldValue(language, '')).toBe('text');
  });

  it('is idempotent — the canonical value maps to itself', () => {
    for (const input of ['TypeScript', 'ts', '', 'cobol', 'bash']) {
      const once = normalizeFieldValue(language, input);
      expect(normalizeFieldValue(language, once as string)).toBe(once);
    }
  });

  it('leaves a non-string, and a leaf declaring no normalize, untouched', () => {
    expect(normalizeFieldValue(language, 42)).toBe(42);
    expect(normalizeFieldValue(language, null)).toBe(null);
    expect(normalizeFieldValue({ type: 'string', maxLength: 10 }, 'TS')).toBe('TS');
    expect(normalizeFieldValue({ type: 'number' }, 3)).toBe(3);
  });

  it('folds with no alias table at all', () => {
    expect(normalizeFieldValue({ type: 'string', normalize: { case: 'lower' } }, 'ABC')).toBe('abc');
  });
});

describe('normalizeFieldValue — the alias table is not a prototype chain', () => {
  /*
   * A plain object literal inherits from `Object.prototype`, so an unguarded
   * `aliases[folded]` answers for keys nobody declared — and case-folding brings
   * every capitalisation of them into reach. The stored value then bypassed both
   * the input schema (which runs BEFORE normalization) and the registration
   * gates (which only ever saw the declared targets): `Constructor` landed 35
   * characters in a field declaring `maxLength: 30`.
   */
  it.each(['constructor', 'Constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'stores the folded input for the inherited key %s, not the inherited value',
    (key) => {
      expect(normalizeFieldValue(language, key)).toBe(key.toLowerCase());
    },
  );

  it('is unaffected by a table built with a null prototype', () => {
    const aliases = Object.create(null) as Record<string, string>;
    aliases.ts = 'typescript';
    const node: FieldNode = { type: 'string', normalize: { case: 'lower', aliases } };
    expect(normalizeFieldValue(node, 'TS')).toBe('typescript');
    expect(normalizeFieldValue(node, 'constructor')).toBe('constructor');
  });
});

describe('normalizePayload', () => {
  const schema = { title: { type: 'string' } as FieldNode, language };

  it('rewrites only the declared fields', () => {
    expect(normalizePayload(schema, { title: 'Keep Me', language: 'TS' })).toEqual({
      title: 'Keep Me',
      language: 'typescript',
    });
  });

  it('leaves an ABSENT key absent — the DDL default fills it, not this', () => {
    expect(normalizePayload(schema, { title: 'x' })).toEqual({ title: 'x' });
  });

  it('returns the same object when nothing changed, so callers can compare cheaply', () => {
    const payload = { title: 'x', language: 'typescript' };
    expect(normalizePayload(schema, payload)).toBe(payload);
  });
});

describe('constraintsOf', () => {
  it('publishes the normalize rule so a caller learns it before a write teaches it', () => {
    const constraints = constraintsOf({ language });
    expect(constraints).toContainEqual({
      field: 'language',
      type: 'normalize',
      case: 'lower',
      aliases: { '': 'text', ts: 'typescript', sh: 'bash' },
    });
    // and still publishes the screening constraints beside it
    expect(constraints).toContainEqual({ field: 'language', type: 'maxLength', maxLength: 30 });
  });
});

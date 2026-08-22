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

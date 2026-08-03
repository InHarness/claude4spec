/**
 * The four LOUD rejections Host API 2.0.0 owes a plugin author.
 *
 * Each corresponds to a failure that, left unchecked, surfaces at boot rather
 * than at load: a generated `CREATE TABLE` with a reserved word in it, a
 * collection whose rows nobody knows where to put, a branch the projection
 * silently drops. The value of testing them here is that the message names the
 * FIELD — an author who reads it knows what to change.
 */

import { describe, expect, it } from 'vitest';
import { validateDataDeclaration } from './data-schema-validation.js';
import type { DataDeclaration } from '../../../shared/plugin-host/data-schema.js';
import type { SlugPattern } from '../../../shared/plugin-host/slug-pattern.js';

const NAME_PATTERN: SlugPattern = [{ op: 'slugify', field: 'name' }];
const OK: DataDeclaration = { schema: { name: { kind: 'string', required: true } } };

const check = (data: DataDeclaration, pattern: SlugPattern = NAME_PATTERN, version = 1) => () =>
  validateDataDeclaration('widget', data, pattern, version);

describe('data.schema — the required triple', () => {
  it('accepts a minimal well-formed declaration', () => {
    expect(check(OK)).not.toThrow();
  });

  it('rejects a missing schema', () => {
    expect(check(undefined as unknown as DataDeclaration)).toThrow(/`data.schema` slot is required/);
  });

  it('rejects a schema declaring no fields', () => {
    expect(check({ schema: {} })).toThrow(/declares no fields/);
  });

  it('rejects a missing or non-integer payloadVersion', () => {
    // Called directly rather than through `check`, whose default parameter would
    // substitute 1 for the `undefined` this case is about.
    expect(() => validateDataDeclaration('widget', OK, NAME_PATTERN, undefined)).toThrow(
      /payloadVersion/,
    );
    expect(check(OK, NAME_PATTERN, 0)).toThrow(/payloadVersion/);
    expect(check(OK, NAME_PATTERN, 1.5)).toThrow(/payloadVersion/);
  });
});

describe('rule 1 — a collection must declare its kind', () => {
  it('rejects a collection with no `collection` flag', () => {
    const data = {
      schema: {
        name: { kind: 'string', required: true },
        items: { kind: 'collection', item: { kind: 'string' } },
      },
    } as unknown as DataDeclaration;

    expect(check(data)).toThrow(/must declare `collection: 'value' \| 'keyed'`/);
  });

  it('rejects a value other than value|keyed rather than defaulting it', () => {
    const data = {
      schema: {
        name: { kind: 'string', required: true },
        items: { kind: 'collection', collection: 'big', item: { kind: 'string' } },
      },
    } as unknown as DataDeclaration;

    expect(check(data)).toThrow(/Got "big"/);
  });

  it('requires a keyed collection to declare its key', () => {
    const data: DataDeclaration = {
      schema: {
        name: { kind: 'string', required: true },
        cells: {
          kind: 'collection',
          collection: 'keyed',
          item: { kind: 'object', fields: { row: { kind: 'number' } } },
        },
      },
    };

    expect(check(data)).toThrow(/must declare keyFields/);
  });

  it('rejects a keyField that is not a field of the item', () => {
    const data: DataDeclaration = {
      schema: {
        name: { kind: 'string', required: true },
        cells: {
          kind: 'collection',
          collection: 'keyed',
          keyFields: ['column'],
          item: { kind: 'object', fields: { row: { kind: 'number' } } },
        },
      },
    };

    expect(check(data)).toThrow(/keyField "column" is not a field of its item/);
  });
});

describe('rule 2 — the integrity vocabulary is closed', () => {
  it('accepts check, unique and fk', () => {
    const data: DataDeclaration = {
      ...OK,
      integrity: [
        { kind: 'check', expr: 'length(name) > 0' },
        { kind: 'unique', fields: ['name'] },
      ],
    };

    expect(check(data)).not.toThrow();
  });

  it('rejects a constraint kind outside the vocabulary', () => {
    const data = {
      ...OK,
      integrity: [{ kind: 'trigger', expr: 'DROP TABLE tag' }],
    } as unknown as DataDeclaration;

    expect(check(data)).toThrow(/outside the closed vocabulary/);
  });

  it('rejects UNIQUE over a field the type does not declare', () => {
    const data: DataDeclaration = { ...OK, integrity: [{ kind: 'unique', fields: ['nope'] }] };

    expect(check(data)).toThrow(/not a domain field of this type/);
  });
});

describe('rule 3 — depth is rejected, never truncated', () => {
  it('rejects a schema nested past the projection limit', () => {
    // Five levels of nested objects — one past MAX_PROJECTION_DEPTH.
    let node = { kind: 'string' } as Record<string, unknown>;
    for (let i = 0; i < 5; i += 1) node = { kind: 'object', fields: { deeper: node } };
    const data = {
      schema: { name: { kind: 'string', required: true }, nest: node },
    } as unknown as DataDeclaration;

    expect(check(data)).toThrow(/past the projection limit/);
  });

  it('accepts the deepest real built-in shape (design-system tokens)', () => {
    const data: DataDeclaration = {
      schema: {
        name: { kind: 'string', required: true },
        groups: {
          kind: 'collection',
          collection: 'value',
          item: {
            kind: 'object',
            fields: {
              tokens: {
                kind: 'collection',
                collection: 'value',
                item: {
                  kind: 'object',
                  fields: {
                    value: { kind: 'record', key: { kind: 'string' }, value: { kind: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(check(data)).not.toThrow();
  });
});

describe('rule 4 — generated identifiers are snake_case and never reserved', () => {
  it('rejects a field projecting to a reserved SQL word', () => {
    const data: DataDeclaration = {
      schema: { name: { kind: 'string', required: true }, order: { kind: 'number' } },
    };

    expect(check(data)).toThrow(/reserved SQL word/);
  });

  it('accepts a reserved-word field that declares an explicit column', () => {
    const data: DataDeclaration = {
      schema: {
        name: { kind: 'string', required: true },
        order: { kind: 'number', column: 'sort_order' },
      },
    };

    expect(check(data)).not.toThrow();
  });

  it('rejects a column name that is not a bare identifier', () => {
    const data: DataDeclaration = {
      schema: { name: { kind: 'string', required: true }, bad: { kind: 'string', column: 'a-b' } },
    };

    expect(check(data)).toThrow(/not a valid SQL identifier/);
  });

  it('rejects a field claiming a column the host owns', () => {
    const data: DataDeclaration = {
      schema: { name: { kind: 'string', required: true }, slug: { kind: 'string' } },
    };

    expect(check(data)).toThrow(/which the host owns/);
  });

  it('camelCases into snake_case rather than rejecting', () => {
    const data: DataDeclaration = {
      schema: { name: { kind: 'string', required: true }, designSystemSlug: { kind: 'string' } },
    };

    expect(check(data)).not.toThrow();
  });
});

describe('slugPattern', () => {
  it('rejects a pattern reading a field the schema does not declare', () => {
    expect(check(OK, [{ op: 'slugify', field: 'caption' }])).toThrow(/not in the schema/);
  });

  it('rejects a pattern that reads only optional fields', () => {
    const data: DataDeclaration = { schema: { caption: { kind: 'string' } } };

    expect(check(data, [{ op: 'slugify', field: 'caption' }])).toThrow(
      /reads only optional fields/,
    );
  });

  it('accepts an optional-only pattern that ends in a nanoid alternative', () => {
    const data: DataDeclaration = { schema: { caption: { kind: 'string' } } };

    expect(
      check(data, [[{ op: 'slugify', field: 'caption' }], [{ op: 'nanoid', n: 8 }]]),
    ).not.toThrow();
  });

  it('accepts an optional-only pattern carrying a literal prefix', () => {
    const data: DataDeclaration = { schema: { caption: { kind: 'string' } } };

    expect(
      check(data, [{ op: 'literal', value: 'x-' }, { op: 'slugify', field: 'caption' }]),
    ).not.toThrow();
  });

  it('rejects a non-positive truncate or nanoid length', () => {
    expect(check(OK, [{ op: 'slugify', field: 'name' }, { op: 'truncate', n: 0 }])).toThrow(
      /truncate\(0\)/,
    );
    expect(check(OK, [{ op: 'nanoid', n: -1 }])).toThrow(/nanoid\(-1\)/);
  });
});

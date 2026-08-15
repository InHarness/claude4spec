/**
 * The LOUD rejections Host API 2.0.0 owes a plugin author.
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
const TITLE: DataDeclaration['schema'] = {
  title: { kind: 'string', required: true, maxLength: 200 },
};
const OK: DataDeclaration = { schema: { ...TITLE, name: { kind: 'string', required: true } } };

/**
 * Every fixture gets the reserved `title` unless it declares one itself.
 *
 * 0.2.22 made it required, so without this each of the ~50 cases below would
 * stop at the title rule and never reach the rule it is actually about. Merged
 * in the helper rather than written into every fixture so the fixtures keep
 * saying only what their own case is about — and the title rule gets its own
 * tests, further down, where it can be the subject.
 */
const withTitle = (data: DataDeclaration): DataDeclaration => {
  if (!data?.schema || !Object.keys(data.schema).length) return data;
  return 'title' in data.schema ? data : { ...data, schema: { ...TITLE, ...data.schema } };
};

const check = (data: DataDeclaration, pattern: SlugPattern = NAME_PATTERN, version = 1) => () =>
  validateDataDeclaration('widget', withTitle(data), pattern, version);

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

/**
 * Axes (tier C). Every one of these is a name pointing at something else, and a
 * name that does not resolve fails far from the declaration and unhelpfully —
 * an unresolvable extent makes `overview` report `undefined` dimensions for a
 * grid that has rows, and nobody sees it until someone opens the entity.
 */
describe('rule 1b — a keyed collection declares two resolvable axes', () => {
  const keyed = (
    overrides: Record<string, unknown> = {},
    parent: Record<string, unknown> = {},
  ): DataDeclaration =>
    ({
      schema: {
        name: { kind: 'string', required: true },
        nRows: { kind: 'number' },
        nCols: { kind: 'number' },
        ...parent,
        cells: {
          kind: 'collection',
          collection: 'keyed',
          keyFields: ['r', 'c'],
          axes: [
            { key: 'r', extent: 'nRows' },
            { key: 'c', extent: 'nCols' },
          ],
          item: {
            kind: 'object',
            fields: {
              r: { kind: 'number' },
              c: { kind: 'number' },
              value: { kind: 'string' },
            },
          },
          ...overrides,
        },
      },
    }) as unknown as DataDeclaration;

  it('accepts a well-formed pair', () => {
    expect(check(keyed())).not.toThrow();
  });

  it('rejects a keyed collection with no axes', () => {
    expect(check(keyed({ axes: undefined }))).toThrow(/must declare exactly two axes/);
  });

  it('rejects one axis — a window is a rectangle, not a line', () => {
    expect(check(keyed({ axes: [{ key: 'r', extent: 'nRows' }] }))).toThrow(
      /must declare exactly two axes/,
    );
  });

  it('rejects an axis key that is not part of the address', () => {
    expect(
      check(
        keyed({
          axes: [
            { key: 'value', extent: 'nRows' },
            { key: 'c', extent: 'nCols' },
          ],
        }),
      ),
    ).toThrow(/axis key "value", which is not one of its keyFields/);
  });

  it('rejects a non-numeric coordinate — a window is a numeric range over it', () => {
    expect(
      check(
        keyed({
          keyFields: ['r', 'value'],
          axes: [
            { key: 'r', extent: 'nRows' },
            { key: 'value', extent: 'nCols' },
          ],
        }),
      ),
    ).toThrow(/axis key "value" is declared as 'string'/);
  });

  it('rejects an extent that is not a field of the parent', () => {
    expect(
      check(
        keyed({
          axes: [
            { key: 'r', extent: 'height' },
            { key: 'c', extent: 'nCols' },
          ],
        }),
      ),
    ).toThrow(/axis extent "height", which is not a field of widget/);
  });

  it('rejects a non-numeric extent — a dimension is a count', () => {
    expect(
      check(
        keyed({
          axes: [
            { key: 'r', extent: 'name' },
            { key: 'c', extent: 'nCols' },
          ],
        }),
      ),
    ).toThrow(/axis extent "name" is declared as 'string'/);
  });

  it('rejects an extent that does not live on the parent row', () => {
    // `overview` reads it off that row, so a collection-valued extent has
    // nowhere to be read from.
    expect(
      check(
        keyed(
          {
            axes: [
              { key: 'r', extent: 'sizes' },
              { key: 'c', extent: 'nCols' },
            ],
          },
          { sizes: { kind: 'collection', collection: 'keyed', item: { kind: 'number' } } },
        ),
      ),
    ).toThrow(/does not live on the widget row|must declare keyFields/);
  });

  it('rejects one field used as both axes', () => {
    expect(
      check(
        keyed({
          axes: [
            { key: 'r', extent: 'nRows' },
            { key: 'r', extent: 'nCols' },
          ],
        }),
      ),
    ).toThrow(/names "r" as both of its axes/);
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

  /**
   * A CHECK expression reaches a MULTI-STATEMENT `db.exec` through generated
   * DDL. Accepting "any non-empty string" reopened, wider, the raw-SQL surface
   * this release deleted `countStat.sqlQuery` to close: the first case below
   * drops a host table at boot — one the entity rebuild cannot regenerate, since
   * plans are not entity files.
   */
  it.each([
    ['statement terminator', "1); DROP TABLE plan; --"],
    ['line comment', "length(name) > 0 -- "],
    ['block comment', 'length(name) > 0 /* x */'],
    ['unbalanced parens', '(1)) '],
    ['semicolon alone', 'length(name) > 0;'],
  ])('rejects a CHECK expression carrying %s', (_label, expr) => {
    expect(check({ ...OK, integrity: [{ kind: 'check', expr }] })).toThrow(
      /allowed set|unbalanced parentheses/,
    );
  });

  it('accepts the ordinary comparison and boolean expressions CHECK is for', () => {
    for (const expr of [
      'length(name) > 0',
      "kind IN ('a', 'b')",
      'a = 1 AND (b <> 2 OR c >= 3)',
      "status != ''",
    ]) {
      expect(check({ ...OK, integrity: [{ kind: 'check', expr }] }), expr).not.toThrow();
    }
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

  /**
   * The generator emits bare identifiers for a table-backed collection's ITEM
   * fields too, and those are the likelier of the two sets to trip: an item
   * object is a small record whose natural field names include `default`, `in`,
   * `order` and `type`. `ui-view.params` already has three of them.
   */
  it('rejects a reserved word in a table-backed collection item field', () => {
    const data: DataDeclaration = {
      schema: {
        name: { kind: 'string', required: true },
        params: {
          kind: 'collection',
          collection: 'value',
          keyFields: ['in'],
          item: {
            kind: 'object',
            fields: { in: { kind: 'string', required: true } },
          },
        },
      },
    };

    expect(check(data)).toThrow(/reserved SQL word/);
  });

  it('leaves an EMBEDDED collection\'s item fields alone — they never become columns', () => {
    // No keyFields ⇒ embedded JSON, so `in` is a JSON key, not an identifier.
    const data: DataDeclaration = {
      schema: {
        name: { kind: 'string', required: true },
        params: {
          kind: 'collection',
          collection: 'value',
          item: { kind: 'object', fields: { in: { kind: 'string' } } },
        },
      },
    };

    expect(check(data)).not.toThrow();
  });
});

describe('systemPrompt.defaultPredicate', () => {
  const withPredicate = (predicate: unknown, data: DataDeclaration = OK) => () =>
    validateDataDeclaration('widget', withTitle(data), NAME_PATTERN, 1, predicate as never);

  it('accepts a predicate over a projected field', () => {
    expect(withPredicate({ field: 'name', in: ['x'] })).not.toThrow();
  });

  it('rejects a field the schema does not declare', () => {
    expect(withPredicate({ field: 'nope', eq: 'x' })).toThrow(/not in the schema/);
  });

  /**
   * The case that 500s every chat turn rather than merely miscounting: the field
   * IS in the schema, so the runtime's absent-field guard does not fire, but it
   * projects to no column and the count throws `no such column`.
   */
  it('rejects a field that projects to no column', () => {
    const data: DataDeclaration = {
      schema: {
        name: { kind: 'string', required: true },
        caption: { kind: 'string', transientInput: true },
      },
    };
    expect(withPredicate({ field: 'caption', eq: 'x' }, data)).toThrow(/projects to no column/);
  });

  it('rejects a predicate with neither eq nor a non-empty in', () => {
    expect(withPredicate({ field: 'name' })).toThrow(/neither/);
    expect(withPredicate({ field: 'name', in: [] })).toThrow(/neither/);
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

  it('accepts an optional-only pattern carrying a literal prefix', () => {
    const data: DataDeclaration = { schema: { caption: { kind: 'string' } } };

    expect(
      check(data, [{ op: 'literal', value: 'x-' }, { op: 'slugify', field: 'caption' }]),
    ).not.toThrow();
  });

  it('rejects a non-positive truncate length', () => {
    expect(check(OK, [{ op: 'slugify', field: 'name' }, { op: 'truncate', n: 0 }])).toThrow(
      /truncate\(0\)/,
    );
  });

  /**
   * 0.2.22 — `nanoid(n)` left the grammar, so an optional-only pattern has ONE
   * escape rather than two: a literal prefix. The alternative it used to have —
   * ending the chain in a random suffix — is exactly what `diagram` did, and
   * dropping it is what turns a repeated title into a visible `SLUG_CONFLICT`
   * instead of two entities nobody knows were meant to be one.
   */
  it('no longer accepts a random suffix as the escape from an optional-only pattern', () => {
    const data: DataDeclaration = { schema: { caption: { kind: 'string' } } };
    expect(
      check(data, [
        [{ op: 'slugify', field: 'caption' }],
        [{ op: 'literal', value: 'diagram-' }],
      ]),
    ).not.toThrow();
  });
});

/**
 * The string constraints are screened exactly as the numeric ones are: rejected
 * where they cannot apply rather than ignored, because a constraint the author
 * believes is enforced is worse than no constraint.
 */
describe('string constraints — pattern and notReserved', () => {
  const withName = (node: Record<string, unknown>) =>
    ({ schema: { name: { kind: 'string', required: true }, f: node } }) as unknown as DataDeclaration;

  it('accepts pattern and notReserved on a string leaf', () => {
    expect(
      check(withName({ kind: 'string', pattern: '^[a-z_]+$', notReserved: 'sql' })),
    ).not.toThrow();
  });

  for (const kind of ['number', 'boolean'] as const) {
    it(`rejects pattern on a ${kind} leaf`, () => {
      expect(check(withName({ kind, pattern: '^x$' }))).toThrow(/carries `pattern`/);
    });
    it(`rejects notReserved on a ${kind} leaf`, () => {
      expect(check(withName({ kind, notReserved: 'sql' }))).toThrow(/carries `notReserved`/);
    });
  }

  /**
   * Compiled at registration so the type name is in the message. `crud-schema-gen`
   * compiles it at router-construction time, which is far from the declaration
   * and only happens for the types whose routers get built.
   */
  it('rejects a pattern that does not compile', () => {
    expect(check(withName({ kind: 'string', pattern: '[' }))).toThrow(/does not compile/);
  });

  it('reaches a leaf nested inside a collection item', () => {
    const data = {
      schema: {
        name: { kind: 'string', required: true },
        rows: {
          kind: 'collection',
          collection: 'value',
          item: { kind: 'object', fields: { n: { kind: 'number', pattern: '^x$' } } },
        },
      },
    } as unknown as DataDeclaration;
    expect(check(data)).toThrow(/carries `pattern`/);
  });
});

/**
 * The three rejections 0.2.22 adds, each stated where the author will read it.
 */
describe('Host API 2.0.0 — the reserved title', () => {
  it('[ac:m13-title-required] rejects a schema without `title`, on the missing-schema path', () => {
    const data: DataDeclaration = { schema: { name: { kind: 'string', required: true } } };
    expect(() => validateDataDeclaration('widget', data, NAME_PATTERN, 1)).toThrow(
      /reserved `title` field is required/,
    );
  });

  it('rejects a `title` declared with the wrong shape', () => {
    for (const title of [
      { kind: 'string' } as const,
      { kind: 'string', required: true } as const,
      { kind: 'string', required: true, maxLength: 80 } as const,
    ]) {
      const data = { schema: { title, name: { kind: 'string' } } } as unknown as DataDeclaration;
      expect(() => validateDataDeclaration('widget', data, NAME_PATTERN, 1)).toThrow(
        /must be declared exactly/,
      );
    }
  });

  it('refuses to let the label itself be content-bearing', () => {
    const data = {
      schema: { title: { kind: 'string', required: true, maxLength: 200, contentBearing: true } },
    } as unknown as DataDeclaration;
    expect(() => validateDataDeclaration('widget', data, NAME_PATTERN, 1)).toThrow(
      /may not be contentBearing/,
    );
  });
});

describe('computedDefault as a derivation', () => {
  const derived = (steps: unknown): DataDeclaration =>
    ({
      schema: {
        title: { kind: 'string', required: true, maxLength: 200, computedDefault: steps },
        text: { kind: 'string', required: true },
      },
    }) as unknown as DataDeclaration;

  const TITLE_PATTERN: SlugPattern = [{ op: 'slugify', field: 'title' }];

  it('accepts a derivation reading a declared field', () => {
    expect(
      check(derived([{ op: 'raw', field: 'text' }, { op: 'truncate', n: 200 }]), TITLE_PATTERN),
    ).not.toThrow();
  });

  it('rejects a derivation reading a field that does not exist', () => {
    expect(check(derived([{ op: 'raw', field: 'nope' }]), TITLE_PATTERN)).toThrow(
      /is not in the schema/,
    );
  });

  it('rejects a derivation reading itself', () => {
    expect(check(derived([{ op: 'raw', field: 'title' }]), TITLE_PATTERN)).toThrow(/reading itself/);
  });

  /**
   * Chaining is refused rather than ordered. Derivation is a single pass at
   * create, so a default reading another computed field would depend on which
   * order the host happened to resolve them in — a fact no reader of the
   * declaration can see.
   */
  it('rejects a derivation reading another computed field', () => {
    const data = {
      schema: {
        title: { kind: 'string', required: true, maxLength: 200, computedDefault: [{ op: 'raw', field: 'label' }] },
        label: { kind: 'string', computedDefault: [{ op: 'raw', field: 'text' }] },
        text: { kind: 'string', required: true },
      },
    } as unknown as DataDeclaration;
    expect(check(data, TITLE_PATTERN)).toThrow(/itself computed/);
  });
});

describe('contentBearing must be reachable', () => {
  const withContent = (extra: Record<string, unknown>): DataDeclaration =>
    ({
      schema: {
        title: { kind: 'string', required: true, maxLength: 200 },
        body: { kind: 'string', contentBearing: true, ...extra },
      },
    }) as unknown as DataDeclaration;

  it('accepts the flag with no operation named — the host generates one', () => {
    expect(check(withContent({}), [{ op: 'slugify', field: 'title' }])).not.toThrow();
  });

  it('rejects a contentOperation that resolves to nothing', () => {
    expect(check(withContent({ contentOperation: 'read_the_body' }), [{ op: 'slugify', field: 'title' }])).toThrow(
      /resolves to no operation/,
    );
  });

  it('rejects a transient field claiming to carry content', () => {
    expect(
      check(withContent({ transientInput: true }), [{ op: 'slugify', field: 'title' }]),
    ).toThrow(/no stored content to issue/);
  });
});

describe('value constraints', () => {
  it('rejects maxLength on a non-string leaf', () => {
    const data = {
      schema: {
        title: { kind: 'string', required: true, maxLength: 200 },
        count: { kind: 'number', maxLength: 5 },
      },
    } as unknown as DataDeclaration;
    expect(check(data)).toThrow(/STRING constraint/);
  });

  it('rejects a non-positive maxLength', () => {
    const data = {
      schema: {
        title: { kind: 'string', required: true, maxLength: 200 },
        note: { kind: 'string', maxLength: 0 },
      },
    } as unknown as DataDeclaration;
    expect(check(data)).toThrow(/must be a positive integer/);
  });
});

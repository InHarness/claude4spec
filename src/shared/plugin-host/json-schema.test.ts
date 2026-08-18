/**
 * The schema deriver, node by node.
 *
 * These replace `auto-schema.test.ts`, which asserted the properties of a
 * reflection over SQLite columns — a derivation that could not see a `record`'s
 * key schema, could not tell a cleared field from a nullable column, and needed
 * a database handle to answer at all. Every case below is one of the things that
 * derivation could not say.
 */

import { describe, expect, it } from 'vitest';
import type { DataDeclaration } from './data-schema.js';
import { nodeSchema, recordSchema, searchablePaths } from './json-schema.js';

const DATA: DataDeclaration = {
  schema: {
    name: { type: 'string', required: true },
    description: { type: 'string', clearable: true },
    status: { type: 'enum', values: ['active', 'deprecated'], default: 'active' },
    caption: { type: 'string', transientInput: true },
    id: { type: 'number', localSurrogate: true },
    designSystemSlug: { type: 'string', ref: 'design-system' },
    params: {
      type: 'collection',
      collection: 'value',
      item: { type: 'object', fields: { name: { type: 'string', required: true } } },
    },
    tokens: { type: 'record', key: { type: 'string' }, value: { type: 'string' } },
  },
};

describe('nodeSchema', () => {
  it('maps every node kind, including the record branch reflection could not see', () => {
    expect(nodeSchema({ type: 'string' })).toEqual({ type: 'string' });
    expect(nodeSchema({ type: 'number' })).toEqual({ type: 'number' });
    expect(nodeSchema({ type: 'boolean' })).toEqual({ type: 'boolean' });
    expect(nodeSchema({ type: 'enum', values: ['a', 'b'] })).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(nodeSchema(DATA.schema.tokens!)).toEqual({
      type: 'object',
      propertyNames: { type: 'string' },
      additionalProperties: { type: 'string' },
    });
  });

  it('derives the nullable union from `clearable` and from nothing else', () => {
    // The flag means "an update may set this to null", which is the same
    // statement as "null is in this field's domain". A field that is merely
    // optional is absent, not null.
    expect(nodeSchema({ type: 'string', clearable: true })).toEqual({ type: ['string', 'null'] });
    expect(nodeSchema({ type: 'string' })).toEqual({ type: 'string' });
  });

  it('carries a collection item schema rather than a bare array', () => {
    expect(nodeSchema(DATA.schema.params!)).toEqual({
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    });
  });
});

describe('recordSchema', () => {
  it('describes the read record exactly: closed, field-keyed, no provenance markers', () => {
    const schema = recordSchema({ type: 'widget', data: DATA });
    const props = schema.properties as Record<string, unknown>;

    expect(schema.additionalProperties).toBe(false);
    /**
     * DECLARED field names, not projection column names.
     *
     * This schema promised `design_system_slug` while `genericEntity` had been
     * re-keying the hydrated row through `byFieldName` since 0.2.22 — so the
     * record said `designSystemSlug` and its own schema contradicted it. One
     * producer, one spelling, and the declaration is the one that wins.
     */
    expect(props.designSystemSlug).toEqual({ type: ['string', 'null'] });
    expect(props.design_system_slug).toBeUndefined();
    // Nullable because the column is: `hydrate` copies every column, so an unset
    // optional field is PRESENT holding null, not absent.
    expect(props._generic).toBeUndefined();
    expect(props._view).toBeUndefined();
    // A collection with its own projection table is not on that row, but it IS
    // part of the record, so a closed schema must still claim it.
    expect(props.params).toBeDefined();
    expect(props.tokens).toBeDefined();
  });

  it('never describes systemManaged timestamps — no record carries them', () => {
    // `hydrate` lifts createdAt/updatedAt out of `entity.data` into a separate
    // `system` slot.
    const withStamps = {
      schema: {
        ...DATA.schema,
        createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
        updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
      },
    } as DataDeclaration;
    const schema = recordSchema({ type: 'widget', data: withStamps });
    const props = schema.properties as Record<string, unknown>;
    expect(props.createdAt).toBeUndefined();
    expect(props.created_at).toBeUndefined();
    expect(schema.required as string[]).not.toContain('createdAt');
  });

  it('admits null into a clearable ENUM\'s value list, not only into its type', () => {
    // Widening `type` alone left the cleared value passing the type keyword and
    // failing the enum keyword — unsatisfiable for the one value the flag exists
    // to permit.
    expect(nodeSchema({ type: 'enum', values: ['a', 'b'], clearable: true })).toEqual({
      type: ['string', 'null'],
      enum: ['a', 'b', null],
    });
  });

  it('excludes inputs that never land and columns that are not reproducible', () => {
    const props = recordSchema({ type: 'widget', data: DATA }).properties as Record<string, unknown>;
    expect(props.caption).toBeUndefined(); // transientInput — feeds the slug, never the payload
    expect(props.id).toBeUndefined(); // localSurrogate — index-only, excluded from every projection
  });

  it('requires a field with a default, not only one marked required', () => {
    /**
     * `required` is promisable again for EVERY type.
     *
     * It used to be carried by the generic schema alone: a computed view built
     * its payload in a function the host could not read, and the real ones were
     * selective, so a `required` list derived from the declaration published a
     * contract those responses violated. With no computed views left there is no
     * such response, and the floor-versus-contract split goes with them.
     */
    const required = recordSchema({ type: 'widget', data: DATA }).required as string[];
    expect(required).toContain('name'); // required
    expect(required).toContain('status'); // default — the column can never be NULL
    // Present but nullable, so it is described as `['string','null']` rather than
    // promised.
    expect(required).not.toContain('description');
  });

  it('is one schema per type — the same call cannot be asked to vary', () => {
    // There is no `view` argument to differ on any more, so two derivations of
    // one type are identical by construction rather than by convention.
    expect(recordSchema({ type: 'widget', data: DATA })).toEqual(
      recordSchema({ type: 'widget', data: DATA }),
    );
  });
});

describe('searchablePaths', () => {
  it('reaches text leaves through collections and records, and skips what search cannot see', () => {
    expect(searchablePaths(DATA)).toEqual(['name', 'description', 'status', 'designSystemSlug', 'params[].name']);
  });
});

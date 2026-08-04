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
import { nodeSchema, searchablePaths, viewSchema } from './json-schema.js';

const DATA: DataDeclaration = {
  schema: {
    name: { kind: 'string', required: true },
    description: { kind: 'string', clearable: true },
    status: { kind: 'enum', values: ['active', 'deprecated'], default: 'active' },
    caption: { kind: 'string', transientInput: true },
    id: { kind: 'number', localSurrogate: true },
    designSystemSlug: { kind: 'string', ref: 'design-system' },
    params: {
      kind: 'collection',
      collection: 'value',
      item: { kind: 'object', fields: { name: { kind: 'string', required: true } } },
    },
    tokens: { kind: 'record', key: { kind: 'string' }, value: { kind: 'string' } },
  },
};

describe('nodeSchema', () => {
  it('maps every node kind, including the record branch reflection could not see', () => {
    expect(nodeSchema({ kind: 'string' })).toEqual({ type: 'string' });
    expect(nodeSchema({ kind: 'number' })).toEqual({ type: 'number' });
    expect(nodeSchema({ kind: 'boolean' })).toEqual({ type: 'boolean' });
    expect(nodeSchema({ kind: 'enum', values: ['a', 'b'] })).toEqual({ type: 'string', enum: ['a', 'b'] });
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
    expect(nodeSchema({ kind: 'string', clearable: true })).toEqual({ type: ['string', 'null'] });
    expect(nodeSchema({ kind: 'string' })).toEqual({ type: 'string' });
  });

  it('carries a collection item schema rather than a bare array', () => {
    expect(nodeSchema(DATA.schema.params!)).toEqual({
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    });
  });
});

describe('viewSchema', () => {
  it('describes the generic view exactly: closed, column-keyed, with the provenance markers', () => {
    const schema = viewSchema({ type: 'widget', data: DATA, view: 'single_element', computed: false });
    const props = schema.properties as Record<string, unknown>;

    expect(schema.additionalProperties).toBe(false);
    expect(props._generic).toEqual({ const: true });
    expect(props._view).toEqual({ const: 'single_element' });
    // Column names, because the generic payload spreads the projection row.
    expect(props.design_system_slug).toEqual({ type: 'string' });
    expect(props.designSystemSlug).toBeUndefined();
  });

  it('describes a computed view as an OPEN floor — the host cannot introspect a function', () => {
    const schema = viewSchema({ type: 'widget', data: DATA, view: 'detail', computed: true });
    const props = schema.properties as Record<string, unknown>;

    expect(schema.additionalProperties).toBe(true);
    expect(schema['x-computed']).toBe(true);
    // Field names here: a computed view emits what the type declares, by name.
    expect(props.designSystemSlug).toEqual({ type: 'string' });
    expect(props._generic).toBeUndefined();
  });

  it('excludes inputs that never land and columns that are not reproducible', () => {
    const props = viewSchema({ type: 'widget', data: DATA, view: 'detail', computed: true })
      .properties as Record<string, unknown>;
    expect(props.caption).toBeUndefined(); // transientInput — feeds the slug, never the payload
    expect(props.id).toBeUndefined(); // localSurrogate — index-only, excluded from every projection
  });

  it('requires a field with a default, not only one marked required', () => {
    const required = viewSchema({ type: 'widget', data: DATA, view: 'detail', computed: true })
      .required as string[];
    expect(required).toContain('name'); // required
    expect(required).toContain('status'); // default — the payload always carries it
    expect(required).not.toContain('description');
  });

  it('differs between two generic views only in the `_view` marker', () => {
    const a = viewSchema({ type: 'widget', data: DATA, view: 'detail', computed: false });
    const b = viewSchema({ type: 'widget', data: DATA, view: 'inline_mention', computed: false });
    const strip = (s: Record<string, unknown>) => ({
      ...s,
      properties: { ...(s.properties as Record<string, unknown>), _view: null },
    });
    expect(strip(a)).toEqual(strip(b));
  });
});

describe('searchablePaths', () => {
  it('reaches text leaves through collections and records, and skips what search cannot see', () => {
    expect(searchablePaths(DATA)).toEqual(['name', 'description', 'status', 'designSystemSlug', 'params[].name']);
  });
});

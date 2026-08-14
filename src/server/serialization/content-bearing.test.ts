/**
 * The `contentBearing` field flag (0.2.19), stated as its own rules.
 *
 * No shipped type carries the flag yet — the first bearer is a later stage — so
 * these are the only place the behaviour is pinned. Written against the three
 * layers that have to agree on it at once: the generated view payload, the
 * derived JSON Schema, and the default diff.
 */

import { describe, expect, it } from 'vitest';
import { genericEntity } from './generic.js';
import { defaultDeepDiff } from './snapshot.js';
import { snapshotFromSchema } from './schema-snapshot.js';
import { recordSchema } from '../../shared/plugin-host/json-schema.js';
import { attachComposition } from '../core/plugin-host/composition-validation.js';
import type { FieldNode } from '../../shared/plugin-host/data-schema.js';
import type { RawEntity } from '../discovery/raw-entity-reader.js';
import type { BackendModule } from '../core/plugin-host/types.js';

const SCHEMA: Record<string, FieldNode> = {
  title: { kind: 'string', required: true, maxLength: 200 },
  body: { kind: 'string', contentBearing: true },
};

function entity(data: Record<string, unknown>): RawEntity {
  return { type: 'doc', slug: 'a-doc', tags: [], data } as unknown as RawEntity;
}

describe('contentBearing — the generated view payload', () => {
  it('replaces the field with has<Field> + <field>Bytes', () => {
    const out = genericEntity(entity({ title: 'T', body: 'hello' }), SCHEMA);
    expect(out).not.toHaveProperty('body');
    expect(out.hasBody).toBe(true);
    expect(out.bodyBytes).toBe(5);
    expect(out.title).toBe('T');
  });

  it('emits the two keys even when the row never carried the column', () => {
    // The derived schema declares both `required`, so a row hydrated without the
    // content column (or written before the field existed) must not produce a
    // payload that fails its own schema.
    const out = genericEntity(entity({ title: 'T' }), SCHEMA);
    expect(out.hasBody).toBe(false);
    expect(out.bodyBytes).toBe(0);
  });

  it('reports an absent body as false / 0 rather than omitting the keys', () => {
    // The keys are part of the view's shape; a consumer must not have to
    // distinguish "no body" from "this host predates the flag".
    const out = genericEntity(entity({ title: 'T', body: null }), SCHEMA);
    expect(out.hasBody).toBe(false);
    expect(out.bodyBytes).toBe(0);
  });

  it('counts UTF-8 BYTES, not characters', () => {
    const out = genericEntity(entity({ title: 'T', body: 'ąę' }), SCHEMA);
    expect(out.bodyBytes).toBe(4);
  });
});

describe('contentBearing — the derived JSON Schema', () => {
  it('describes the two derived keys, and neither declares the field itself', () => {
    const schema = recordSchema({ type: 'doc', data: { schema: SCHEMA } });
    const props = schema.properties as Record<string, unknown>;
    expect(props).not.toHaveProperty('body');
    expect(props.hasBody).toEqual({ type: 'boolean' });
    expect(props.bodyBytes).toEqual({ type: 'integer' });
    // Always emitted, so always required — the payload above proves it.
    expect(schema.required as string[]).toEqual(expect.arrayContaining(['hasBody', 'bodyBytes']));
  });
});

describe('contentBearing — the snapshot', () => {
  it('KEEPS the field: it is reproducible from the entity file, so the projection invariant binds it', () => {
    const module = { type: 'doc', data: { schema: SCHEMA } } as unknown as Parameters<typeof snapshotFromSchema>[0];
    const snap = snapshotFromSchema(module, entity({ title: 'T', body: 'hello' }), {
      reader: { readCollection: () => [] },
    } as unknown as Parameters<typeof snapshotFromSchema>[2]);
    expect(snap).toMatchObject({ title: 'T', body: 'hello' });
  });
});

describe('contentBearing — the default diff', () => {
  it('reports bytes rather than two bodies nobody can compare', () => {
    const diff = defaultDeepDiff('doc', 'a-doc', { title: 'T', body: 'hello' }, { title: 'T', body: 'hello world' }, SCHEMA);
    expect(diff.op).toBe('modified');
    expect(diff.raw?.changed).toEqual({ body_changed: { fromBytes: 5, toBytes: 11 } });
    expect(JSON.stringify(diff)).not.toContain('hello world');
  });

  it('still diffs ordinary fields beside it', () => {
    const diff = defaultDeepDiff('doc', 'a-doc', { title: 'T', body: 'x' }, { title: 'U', body: 'x' }, SCHEMA);
    expect(diff.raw?.changed).toEqual({ title: { from: 'T', to: 'U' } });
  });

  it('treats an appearing body as a change from zero bytes, not as an `added` payload', () => {
    const diff = defaultDeepDiff('doc', 'a-doc', { title: 'T' }, { title: 'T', body: 'hello' }, SCHEMA);
    expect(diff.raw?.added).toEqual({});
    expect(diff.raw?.changed).toEqual({ body_changed: { fromBytes: 0, toBytes: 5 } });
  });

  it('says nothing about a body that did not change', () => {
    const diff = defaultDeepDiff('doc', 'a-doc', { title: 'T', body: 'same' }, { title: 'U', body: 'same' }, SCHEMA);
    expect(diff.raw?.changed).not.toHaveProperty('body_changed');
  });

  it('does not ship the body of a CREATED entity — the whole-entity payload is stripped too', () => {
    // `created` reports the entity under a single `/` key, so the body rides
    // inside a value, not under a key named after the field. A newly added entity
    // is exactly where the body is biggest.
    const diff = defaultDeepDiff('doc', 'a-doc', null, { title: 'T', body: 'SECRET-BIG-BODY' }, SCHEMA);
    expect(diff.op).toBe('created');
    expect(JSON.stringify(diff)).not.toContain('SECRET-BIG-BODY');
    expect(diff.raw?.added).toEqual({ '/': { title: 'T' } });
    expect(diff.raw?.changed).toEqual({ body_changed: { fromBytes: 0, toBytes: 15 } });
  });

  it('does not ship the body of a DELETED entity either', () => {
    const diff = defaultDeepDiff('doc', 'a-doc', { title: 'T', body: 'SECRET-BIG-BODY' }, null, SCHEMA);
    expect(diff.op).toBe('deleted');
    expect(JSON.stringify(diff)).not.toContain('SECRET-BIG-BODY');
    expect(diff.raw?.removed).toEqual({ '/': { title: 'T' } });
    expect(diff.raw?.changed).toEqual({ body_changed: { fromBytes: 15, toBytes: 0 } });
  });

  it('falls back to raw values with no schema — an inactive type keeps a usable diff', () => {
    const diff = defaultDeepDiff('doc', 'a-doc', { body: 'a' }, { body: 'b' });
    expect(diff.raw?.changed).toEqual({ body: { from: 'a', to: 'b' } });
  });
});

describe('contentBearing — load-time validation', () => {
  function moduleWith(views: unknown): BackendModule {
    return {
      type: 'doc',
      data: { schema: SCHEMA },
      slugPattern: [{ op: 'slugify', field: 'title' }],
      payloadVersion: 1,
      label: 'Doc',
      labelPlural: 'Docs',
      displayOrder: 1,
      pathPrefix: '/docs',
      serializer: (views ? { views, payloadVersion: 1 } : { payloadVersion: 1 }),
      systemPrompt: { roleNoun: 'doc' },
    } as unknown as BackendModule;
  }

  /**
   * 0.2.22 REVERSED this pair.
   *
   * The rule was: a type may not compute its own `views` AND declare a
   * contentBearing field, because exclusion was a property of the VIEW and the
   * host could not honour it inside a function it cannot read. Exclusion is a
   * property of the READ now — `project()` runs after serialization, over the
   * schema, whoever produced the payload — so the conflict cannot arise and the
   * ban is gone. `diagram` is the type that needed it lifted: it computes views
   * and its `source` is the first content-bearing field in the specification.
   */
  it('accepts a type that declares its own views AND a contentBearing field', () => {
    expect(() => attachComposition(moduleWith({ detail: () => ({}) }), [])).not.toThrow();
  });

  it('accepts one that computes no views either', () => {
    expect(() => attachComposition(moduleWith(null), [])).not.toThrow();
  });

  /**
   * What replaced the ban: the content must be REACHABLE. A type naming its own
   * operation is checked against the operation catalog, because a field excluded
   * from every generic read with nothing behind it is write-only data.
   */
  it('rejects a contentOperation that resolves to no operation', () => {
    const module = moduleWith(null);
    (module.data!.schema as Record<string, FieldNode>).body = {
      kind: 'string',
      contentBearing: true,
      contentOperation: 'read_the_body',
    };
    expect(() => attachComposition(module, [])).toThrow(/resolves to no operation/);
  });
});

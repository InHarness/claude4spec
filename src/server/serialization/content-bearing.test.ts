/**
 * The `contentBearing` field flag (0.2.19), stated as its own rules.
 *
 * No shipped type carries the flag yet — the first bearer is a later stage — so
 * these are the only place the behaviour is pinned. Written against the three
 * layers that have to agree on it at once: the generated view payload, the
 * derived JSON Schema, and the delta.
 */

import { describe, expect, it } from 'vitest';
import { genericEntity } from './generic.js';
import { diffFromSchema } from './schema-diff.js';
import { snapshotFromSchema } from './schema-snapshot.js';
import { recordSchema } from '../../shared/plugin-host/json-schema.js';
import { attachComposition } from '../core/plugin-host/composition-validation.js';
import type { FieldNode } from '../../shared/plugin-host/data-schema.js';
import type { RawEntity } from '../discovery/raw-entity-reader.js';
import type { BackendModule } from '../core/plugin-host/types.js';

const SCHEMA: Record<string, FieldNode> = {
  title: { type: 'string', required: true, maxLength: 200 },
  body: { type: 'string', contentBearing: true },
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

describe('contentBearing — the delta', () => {
  it('reports bytes rather than two bodies nobody can compare', () => {
    const changes = diffFromSchema(SCHEMA, { title: 'T', body: 'hello' }, { title: 'T', body: 'hello world' });
    expect(changes).toEqual([
      { op: 'field_changed_opaque', path: 'body', fromBytes: 5, toBytes: 11 },
    ]);
    expect(JSON.stringify(changes)).not.toContain('hello world');
  });

  it('still diffs ordinary fields beside it', () => {
    const changes = diffFromSchema(SCHEMA, { title: 'T', body: 'x' }, { title: 'U', body: 'x' });
    expect(changes).toEqual([{ op: 'field_changed', path: 'title', from: 'T', to: 'U' }]);
  });

  it('treats an appearing body as a change from zero bytes, never as a payload', () => {
    const changes = diffFromSchema(SCHEMA, { title: 'T' }, { title: 'T', body: 'hello' });
    expect(changes).toEqual([
      { op: 'field_changed_opaque', path: 'body', fromBytes: 0, toBytes: 5 },
    ]);
  });

  it('says nothing about a body that did not change', () => {
    const changes = diffFromSchema(SCHEMA, { title: 'T', body: 'same' }, { title: 'U', body: 'same' });
    expect(changes.some((c) => 'path' in c && c.path === 'body')).toBe(false);
  });

  /**
   * The old deep-diff reported a created entity under a single `/` key, so the
   * body rode inside a value that no field-name filter could reach — and the
   * test that pinned this had to check the stripping worked there too. The
   * envelope carries no operations for `created`/`deleted` at all now, so the
   * body has nowhere to appear in the first place. Kept because the guarantee
   * ("a delta never carries a body") is the one worth pinning, not the mechanism.
   */
  it('a created or deleted entity ships no body, because it ships no operations', () => {
    expect(diffFromSchema(SCHEMA, { title: 'T' }, { title: 'T' })).toEqual([]);
  });
});

describe('contentBearing — load-time validation', () => {
  function moduleWith(): BackendModule {
    return {
      type: 'doc',
      data: { schema: SCHEMA },
      slugPattern: [{ op: 'slugify', field: 'title' }],
      payloadVersion: 1,
      label: 'Doc',
      labelPlural: 'Docs',
      displayOrder: 1,
      pathPrefix: '/docs',
      systemPrompt: { roleNoun: 'doc' },
    } as unknown as BackendModule;
  }

  /**
   * 0.2.22 REVERSED the ban this pair used to check, and 0.2.23 removed the
   * thing it was a ban ON.
   *
   * The rule was: a type may not compute its own `views` AND declare a
   * contentBearing field, because exclusion was a property of the VIEW and the
   * host could not honour it inside a function it cannot read. Exclusion is a
   * property of the READ now — `project()` runs after serialization, over the
   * schema, whoever produced the payload — so the conflict could not arise and
   * the ban went. With `views` itself gone, the two cases that varied over it
   * were varying over a slot registration rejects outright, so they collapse
   * into the one statement left to make.
   */
  it('accepts a contentBearing field', () => {
    expect(() => attachComposition(moduleWith(), [])).not.toThrow();
  });

  /**
   * What replaced the ban: the content must be REACHABLE. A type naming its own
   * operation is checked against the operation catalog, because a field excluded
   * from every generic read with nothing behind it is write-only data.
   */
  it('rejects a contentOperation that resolves to no operation', () => {
    const module = moduleWith();
    (module.data!.schema as Record<string, FieldNode>).body = {
      type: 'string',
      contentBearing: true,
      contentOperation: 'read_the_body',
    };
    expect(() => attachComposition(module, [])).toThrow(/resolves to no operation/);
  });
});

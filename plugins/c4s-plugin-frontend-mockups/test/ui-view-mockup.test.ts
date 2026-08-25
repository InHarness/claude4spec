import { describe, expect, it } from 'vitest';
import { uiViewEntity } from '../src/entity/ui-view/index.js';
import { uiViewSerialization, type UiViewSnapshot } from '../src/entity/ui-view/serializer.js';
import { uiViewPayloadV2ToV3, uiViewPayloadV3ToV4 } from '../src/entity/ui-view/upgrades.js';
import { uiViewData } from '../src/entity/ui-view/schema.js';
import { snapshotFromSchema } from '../../../src/server/serialization/schema-snapshot.js';
import { canonicalize } from '../../../src/server/serialization/snapshot.js';
import { diffFromSchema } from '../../../src/server/serialization/schema-diff.js';
import { genericEntity } from '../../../src/server/serialization/generic.js';
import { hostDefaultFields } from '../../../src/server/discovery/search/fields.js';
import type { RawEntity } from '../src/host-kit/host-types.js';

/**
 * `mockupHtml` — the corpus's second `contentBearing` field.
 *
 * Almost none of what this checks is written in the plugin: the flag is the
 * mechanism and the HOST honours it. That is exactly why the behaviour is pinned
 * from the declaring type's side — the plugin's guarantee to its callers is that
 * these things are true of `ui-view`, not that some shared helper was called.
 */

const reader = { readCollection: () => [] } as never;
const snapshot = (e: RawEntity): UiViewSnapshot =>
  snapshotFromSchema(uiViewEntity, e, reader) as unknown as UiViewSnapshot;

/** A mockup with a multi-byte character, so a byte count cannot be a `.length`. */
const MOCKUP = '<main><h1>Profil użytkownika</h1></main>';
const MOCKUP_BYTES = Buffer.byteLength(MOCKUP, 'utf8');

/**
 * A `RawEntity` is the projection ROW, so its `data` is keyed by COLUMN — which
 * is why the mockup arrives as `mockup_html` here and leaves as `mockupHtml`.
 */
function rawEntity(
  { mockupHtml, ...rest }: Record<string, unknown>,
  tags: string[] = [],
): RawEntity {
  const data = { ...rest, ...(mockupHtml === undefined ? {} : { mockup_html: mockupHtml }) };
  return { type: 'ui-view', slug: String(data.slug ?? 'v'), data, tags };
}

describe('ui-view mockupHtml — the read contract', () => {
  it('never travels in a record; the descriptors go instead', () => {
    const record = genericEntity(
      rawEntity({ slug: 'user-profile', title: 'User Profile', mockupHtml: MOCKUP }),
      uiViewData.schema,
    );
    expect(record).not.toHaveProperty('mockupHtml');
    expect(record.hasMockupHtml).toBe(true);
    expect(record.mockupHtmlBytes).toBe(MOCKUP_BYTES);
  });

  it('counts BYTES, not characters — the descriptor is a cost estimate', () => {
    // 'ż' and 'ó' are two bytes each in UTF-8; a `.length` would under-report the
    // very number a caller uses to decide whether to fetch the thing.
    expect(MOCKUP_BYTES).toBeGreaterThan(MOCKUP.length);
  });

  it('still emits both descriptors when the view has no mockup', () => {
    const record = genericEntity(rawEntity({ slug: 'v', title: 'V' }), uiViewData.schema);
    expect(record.hasMockupHtml).toBe(false);
    expect(record.mockupHtmlBytes).toBe(0);
  });

  it('is out of search scope — HTML tags do not belong in search results', () => {
    const paths = hostDefaultFields(uiViewEntity as never).map((f) => f.path);
    expect(paths).not.toContain('mockupHtml');
    // …while the fields a person would actually search by stay in scope.
    expect(paths).toContain('title');
  });
});

describe('ui-view mockupHtml — serialization', () => {
  /**
   * The flag governs READS, not serialisation. A snapshot without the blob would
   * stop the entity file being the source of truth.
   */
  it('keeps the FULL content in the snapshot', () => {
    const snap = snapshot(rawEntity({ slug: 'user-profile', title: 'User Profile', mockupHtml: MOCKUP }));
    expect(snap.mockupHtml).toBe(MOCKUP);
  });

  it('round-trips byte for byte, including whitespace it would be tempting to trim', () => {
    const messy = `  <div>\n  <p>unclosed\n\n`;
    const once = snapshot(rawEntity({ slug: 'v', title: 'V', mockupHtml: messy }));
    const twice = snapshot(rawEntity({ slug: 'v', title: 'V', mockupHtml: once.mockupHtml }));
    expect(canonicalize(once)).toEqual(canonicalize(twice));
    expect(twice.mockupHtml).toBe(messy);
  });

  it('is null, not absent, when the view has no mockup', () => {
    expect(snapshot(rawEntity({ slug: 'v', title: 'V' })).mockupHtml).toBeNull();
  });
});

/**
 * 0.2.31 — `mockup_changed` is gone, replaced by the generic
 * `field_changed_opaque` with `path: 'mockupHtml'`.
 *
 * The old operation was AUTHORIAL: `ui-view` overrode `diff`, so it did not get
 * the content-bearing treatment for free and said so itself, in a name only it
 * used. Every other type with such a field invented its own name too
 * (`source_changed` on `diagram`). One encoding now covers all of them, and it
 * is the flag's meaning rather than a per-type convention.
 */
describe('ui-view mockupHtml — the delta', () => {
  const schema = uiViewEntity.data!.schema;
  const view = (mockupHtml: string | null) => ({
    slug: 'v',
    title: 'V',
    url: null,
    description: null,
    params: [],
    designSystemSlug: null,
    mockupHtml,
    tags: [],
  });

  it('reports bytes, never the value', () => {
    const changes = diffFromSchema(schema, view(null), view(MOCKUP));
    expect(changes).toEqual([
      { op: 'field_changed_opaque', path: 'mockupHtml', fromBytes: 0, toBytes: MOCKUP_BYTES },
    ]);
    expect(JSON.stringify(changes)).not.toContain('Profil');
  });

  it('reports a removal as a change too, in the same shape', () => {
    expect(diffFromSchema(schema, view(MOCKUP), view(null))).toEqual([
      { op: 'field_changed_opaque', path: 'mockupHtml', fromBytes: MOCKUP_BYTES, toBytes: 0 },
    ]);
  });

  it('says nothing when the mockup did not move', () => {
    expect(diffFromSchema(schema, view(MOCKUP), view(MOCKUP))).toEqual([]);
  });
});

/**
 * `params` is the corpus's only `rekeyOn` declaration, and the reason it exists.
 *
 * `id` in the path and `id` in the query are different parameters, so the
 * identity is the pair `(name, in)`. But MOVING a parameter from path to query
 * is one edit, and reporting it as a removal plus an unrelated-looking addition
 * loses that. The second matching pass, on `name` alone, recovers it.
 */
describe('ui-view params — the two-pass match', () => {
  const schema = uiViewEntity.data!.schema;
  const withParams = (params: unknown[]) => ({
    slug: 'v',
    title: 'V',
    url: null,
    description: null,
    params,
    states: [],
    designSystemSlug: null,
    mockupHtml: null,
    tags: [],
  });

  it('reports a path → query move as a rekey, not as a remove/add pair', () => {
    const a = withParams([{ name: 'id', in: 'path', type: 'string', required: true }]);
    const b = withParams([{ name: 'id', in: 'query', type: 'string', required: true }]);
    expect(diffFromSchema(schema, a, b)).toEqual([
      {
        op: 'item_rekeyed',
        path: 'params',
        identity: { name: 'id', in: 'query' },
        field: 'in',
        from: 'path',
        to: 'query',
      },
    ]);
  });

  it('keeps two same-named parameters in different locations distinct', () => {
    const a = withParams([{ name: 'id', in: 'path' }]);
    const b = withParams([{ name: 'id', in: 'path' }, { name: 'id', in: 'query' }]);
    expect(diffFromSchema(schema, a, b)).toEqual([
      {
        op: 'item_added',
        path: 'params',
        identity: { name: 'id', in: 'query' },
        item: { name: 'id', in: 'query' },
      },
    ]);
  });

  /**
   * The ambiguity rule, and it degrades SILENTLY on purpose. With two orphans a
   * side sharing a `rekeyOn` key there is no fact about which moved into which,
   * so the honest report is the remove/add pair — and a warning about it would
   * be a warning that the data is ordinary.
   */
  it('degrades to remove + add when the rekey would be a guess', () => {
    const a = withParams([
      { name: 'id', in: 'path' },
      { name: 'id', in: 'hash' },
    ]);
    const b = withParams([
      { name: 'id', in: 'query' },
      { name: 'id', in: 'header' },
    ]);
    const ops = diffFromSchema(schema, a, b).map((c) => c.op);
    expect(ops).not.toContain('item_rekeyed');
    expect(ops.filter((o) => o === 'item_removed')).toHaveLength(2);
    expect(ops.filter((o) => o === 'item_added')).toHaveLength(2);
  });
});

describe('ui-view mockupHtml — the payload upgrade', () => {
  it('writes the field explicitly absent rather than leaving the key off', () => {
    // Present-and-null is what every other layer means by "no mockup"; leaving
    // the key out would make "not migrated" and "no mockup" the same shape.
    expect(uiViewPayloadV2ToV3({ slug: 'v', title: 'V' } as never)).toEqual({
      slug: 'v',
      title: 'V',
      mockupHtml: null,
    });
  });

  it('never overwrites a mockup that is already there', () => {
    expect(uiViewPayloadV2ToV3({ slug: 'v', mockupHtml: MOCKUP } as never)).toMatchObject({
      mockupHtml: MOCKUP,
    });
  });

  it('declares one step per version transition', () => {
    expect(uiViewSerialization.payloadUpgrades).toHaveLength(uiViewEntity.payloadVersion! - 1);
  });
});

describe('ui-view states — the one-level match', () => {
  const schema = uiViewEntity.data!.schema;
  const withStates = (states: unknown[]) => ({
    slug: 'v',
    title: 'V',
    url: null,
    description: null,
    params: [],
    states,
    designSystemSlug: null,
    mockupHtml: null,
    tags: [],
  });

  it('round-trips through the snapshot', () => {
    const states = [{ name: 'empty', label: 'Empty', description: 'Nothing matched.' }];
    const snap = snapshot(rawEntity({ slug: 'v', title: 'V', states }));
    expect(snap.states).toEqual(states);
    expect(canonicalize(snap)).toEqual(canonicalize(canonicalize(snap)));
  });

  it('is an empty array, never null, when the view declares no states', () => {
    // `states[]` carries no `clearable` flag, so `null` is not one of its
    // values anywhere — the empty array IS "declares nothing".
    expect(snapshot(rawEntity({ slug: 'v', title: 'V' })).states).toEqual([]);
  });

  it('matches items by name — an added state is one op', () => {
    const a = withStates([{ name: 'empty' }]);
    const b = withStates([{ name: 'empty' }, { name: 'loading' }]);
    expect(diffFromSchema(schema, a, b)).toEqual([
      { op: 'item_added', path: 'states', identity: { name: 'loading' }, item: { name: 'loading' } },
    ]);
  });

  it('reports an edited label as a modification of the same item', () => {
    const a = withStates([{ name: 'empty', label: 'Empty' }]);
    const b = withStates([{ name: 'empty', label: 'Pusty' }]);
    const ops = diffFromSchema(schema, a, b).map((c) => c.op);
    expect(ops).toEqual(['item_modified']);
  });

  it('says nothing about a pure reorder — the match is by identity, not by index', () => {
    const a = withStates([{ name: 'empty' }, { name: 'loading' }]);
    const b = withStates([{ name: 'loading' }, { name: 'empty' }]);
    expect(diffFromSchema(schema, a, b)).toEqual([]);
  });

  it('never emits item_rekeyed — the identity is one field, with nowhere to move', () => {
    // The whole difference from `params[]`, whose ('name','in') identity plus
    // `rekeyOn: ['name']` exists so a path → query move reads as one op. A state
    // has no second axis, so a renamed state is a removal and an addition.
    const a = withStates([{ name: 'empty', label: 'Empty' }]);
    const b = withStates([{ name: 'pusty', label: 'Empty' }]);
    const ops = diffFromSchema(schema, a, b).map((c) => c.op).sort();
    expect(ops).toEqual(['item_added', 'item_removed']);
  });

  it('is IN search scope — a state name and its meaning are ordinary spec text', () => {
    const paths = hostDefaultFields(uiViewEntity as never).map((f) => f.path);
    expect(paths).toContain('states[].name');
    expect(paths).toContain('states[].label');
    expect(paths).toContain('states[].description');
  });
});

describe('ui-view states — the payload upgrade', () => {
  it('writes an empty array rather than leaving the key off', () => {
    expect(uiViewPayloadV3ToV4({ slug: 'v', title: 'V' } as never)).toEqual({
      slug: 'v',
      title: 'V',
      states: [],
    });
  });

  it('never overwrites states that are already there', () => {
    const states = [{ name: 'empty' }];
    expect(uiViewPayloadV3ToV4({ slug: 'v', states } as never)).toMatchObject({ states });
  });
});

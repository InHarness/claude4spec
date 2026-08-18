import { describe, expect, it } from 'vitest';
import { uiViewEntity } from '../src/entity/ui-view/index.js';
import { uiViewSerialization, type UiViewSnapshot } from '../src/entity/ui-view/serializer.js';
import { uiViewPayloadV2ToV3 } from '../src/entity/ui-view/upgrades.js';
import { uiViewData } from '../src/entity/ui-view/schema.js';
import { snapshotFromSchema } from '../../../src/server/serialization/schema-snapshot.js';
import { canonicalize } from '../../../src/server/serialization/snapshot.js';
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

describe('ui-view mockupHtml — the diff', () => {
  const diff = uiViewSerialization.diff;
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

  /**
   * A sibling field, NOT a `meta_changes` entry: that enum is for changes with a
   * readable from/to, which tens of kilobytes of HTML has not.
   */
  it('reports bytes, never the value', () => {
    const d = diff(view(null), view(MOCKUP), 'v') as { changes: Record<string, unknown> };
    expect(d.changes.mockup_changed).toEqual({ fromBytes: 0, toBytes: MOCKUP_BYTES });
    expect(JSON.stringify(d)).not.toContain('Profil');
    expect(d.changes.meta_changes).toBeUndefined();
  });

  it('reports a removal as a change too, in the same shape', () => {
    const d = diff(view(MOCKUP), view(null), 'v') as { changes: Record<string, unknown> };
    expect(d.changes.mockup_changed).toEqual({ fromBytes: MOCKUP_BYTES, toBytes: 0 });
  });

  it('says nothing when the mockup did not move', () => {
    expect(diff(view(MOCKUP), view(MOCKUP), 'v')).toMatchObject({ op: 'noop' });
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

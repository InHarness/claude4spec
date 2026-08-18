/**
 * L9 dispatch, at the seam where a plugin's declaration meets the host's reader.
 *
 * There used to be three lookup outcomes here — declared view → computed,
 * undeclared view → generic, unknown type → a marker for the core to map — and
 * a fourth, worst arm where a plugin's own view function threw. 0.2.23 removed
 * the views, and with them every branch but one: the host derives the record
 * from `data.schema` for every type alike. What is left to pin is that the one
 * remaining producer really is schema-driven, and that a type the host cannot
 * resolve fails LOUDLY rather than coming back as a plausible-looking record.
 */

import { describe, expect, it } from 'vitest';
import { fixtureModule, FIXTURE_DATA } from '../../../../tests/helpers/fixture-module.js';
import { SerializationEngine } from './serialization-engine.js';
import type { BackendModule, ProjectPluginHost } from './types.js';
import type { RawEntity, RawEntityReader } from '../../discovery/raw-entity-reader.js';

const ENTITY: RawEntity = {
  type: 'widget',
  slug: 'w1',
  data: { name: 'Widget One' },
  tags: ['t'],
};

/** Only the three members the engine actually reaches for. */
function hostWith(modules: BackendModule[]): ProjectPluginHost {
  const byType = new Map(modules.map((m) => [m.type, m]));
  return {
    getAvailable: (type: string) => byType.get(type) ?? null,
    getEntity: (type: string) => byType.get(type) ?? null,
    listEntities: () => [...byType.values()],
  } as unknown as ProjectPluginHost;
}

function declaredModule(type = 'widget'): BackendModule {
  const mod = fixtureModule(type);
  return { ...mod, data: FIXTURE_DATA };
}

const reader = { count: () => 0 } as unknown as RawEntityReader;

/**
 * A type whose collections live in their OWN projection tables — the case the
 * host had to take over in 0.2.23, since the view that used to fetch them is
 * gone. `projectionTable` is what puts a collection off the entity's row.
 */
const WITH_COLLECTIONS = {
  schema: {
    title: { type: 'string', required: true, default: 'Untitled' },
    // `keyFields` is what moves a VALUE collection off the row (hasProjectionTable).
    links: { type: 'collection', collection: 'value', keyFields: ['name'], item: { type: 'string' } },
    cells: { type: 'collection', collection: 'keyed', item: { type: 'string' } },
  },
} as unknown as BackendModule['data'];

function collectionModule(): BackendModule {
  return { ...fixtureModule('widget'), data: WITH_COLLECTIONS };
}

const collectionReader = {
  count: () => 0,
  readCollection: () => ['a', 'b'],
  countCollection: () => 7,
} as unknown as RawEntityReader;

describe('SerializationEngine.serializeEntity — one producer, one shape', () => {
  it('derives the record from the type"s declared schema, with no provenance markers', () => {
    const engine = new SerializationEngine(hostWith([declaredModule()]));

    const out = engine.serializeEntity('widget', ENTITY, reader);

    expect(out.data).toMatchObject({ type: 'widget', slug: 'w1', tags: ['t'] });
    /**
     * `_generic` / `_type` / `_view` are gone, and their absence is the point of
     * the release rather than tidying. Each marked which of two producers built
     * the payload; with one producer they said the same thing on every record,
     * which is to say nothing.
     */
    expect(out.data).not.toHaveProperty('_generic');
    expect(out.data).not.toHaveProperty('_type');
    expect(out.data).not.toHaveProperty('_view');
  });

  it('answers the same shape however many times it is asked — there is no width axis left', () => {
    const engine = new SerializationEngine(hostWith([declaredModule()]));

    // The `view` argument used to sit between `type` and `entity` and pick one
    // of five shapes. Two calls that would once have differed now cannot.
    const a = engine.serializeEntity('widget', ENTITY, reader);
    const b = engine.serializeEntity('widget', ENTITY, reader);

    expect(a.data).toEqual(b.data);
    // Narrowing is the CALLER's, applied after this by `discovery/project.ts`.
    expect(a).not.toHaveProperty('generic');
    expect(a).not.toHaveProperty('brokenRefs');
  });

  it('[ac:ac-helper-serialize-host-type-view-entit] THROWS on a type the host cannot resolve, rather than shaping an apology', () => {
    /**
     * The engine used to answer an unknown type with a generic payload plus
     * `error: 'unknown_type'`, which a caller reading only `data` could not tell
     * from a real record. It throws now, and M39 maps it to `INVALID_TYPE` —
     * the ONE code this lookup produces.
     *
     * Not the same gate as deactivation: the engine resolves through
     * `getAvailable`, which still answers for a loaded-but-inactive type, so a
     * deactivated type is refused earlier, by the discovery core's
     * `requireActiveType` (which goes through `getEntity`).
     */
    const engine = new SerializationEngine(hostWith([]));

    expect(() => engine.serializeEntity('widget', ENTITY, reader)).toThrow(/not registered or not active/);
  });

  it("does not let one type's absence reach another type in the same batch", () => {
    const engine = new SerializationEngine(hostWith([declaredModule('gadget')]));

    expect(() => engine.serializeEntity('widget', ENTITY, reader)).toThrow();
    expect(
      engine.serializeEntity('gadget', { ...ENTITY, type: 'gadget' }, reader).data,
    ).toMatchObject({ type: 'gadget', slug: 'w1' });
  });
});

describe('SerializationEngine — the record and its published schema agree', () => {
  /**
   * The schema is CLOSED (`additionalProperties: false`), so every key the
   * record carries must be a key the schema declares — otherwise the host
   * publishes a contract its own payloads violate on every entity that has a
   * projected collection.
   *
   * This is not hypothetical: the first cut of 0.2.23 taught `genericEntity` to
   * materialise those collections without teaching `recordSchema` about them, so
   * `describe_types` promised an `endpoint` shape with no `linkedDtos` while
   * every endpoint record had one.
   */
  it('declares every key the record carries, projected collections included', () => {
    const engine = new SerializationEngine(hostWith([collectionModule()]));

    // Only DECLARED columns on the row: an undeclared one passes through by
    // design (a table mid-migration), and it is the schema-derived keys this
    // case is about.
    const entity = { ...ENTITY, data: { title: 'Widget One' } };
    const record = engine.serializeEntity('widget', entity, collectionReader).data as Record<string, unknown>;
    const schema = engine.describe('widget')!.schemas.record!;
    const declared = Object.keys(schema.properties as Record<string, unknown>);

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(record).filter((k) => !declared.includes(k))).toEqual([]);
    expect(declared).toContain('links');
    expect(declared).toContain('cells');
  });

  it('carries a value collection inline and a keyed one as its count — and COUNTS the keyed one rather than reading it', () => {
    const engine = new SerializationEngine(hostWith([collectionModule()]));

    const record = engine.serializeEntity('widget', ENTITY, collectionReader).data as Record<string, unknown>;

    expect(record.links).toEqual(['a', 'b']);
    // 7 comes from `countCollection`; `readCollection` would have said 2. A
    // 200x40 sheet must not decode 8 000 rows to report how many there are.
    expect(record.cells).toEqual({ count: 7 });
  });

  it('does not read a collection the caller did not select', () => {
    const engine = new SerializationEngine(hostWith([collectionModule()]));
    let reads = 0;
    const counting = {
      count: () => 0,
      readCollection: () => { reads++; return []; },
      countCollection: () => { reads++; return 0; },
    } as unknown as RawEntityReader;

    // `select: []` is what a list page's element rendering asks for. Narrowing
    // downstream would answer the same, but only after paying one query per row.
    engine.serializeEntity('widget', ENTITY, counting, []);

    expect(reads).toBe(0);
  });
});

describe('SerializationEngine.describe — one schema per type', () => {
  it('publishes a single record schema instead of one per view', () => {
    const engine = new SerializationEngine(hostWith([declaredModule()]));

    const described = engine.describe('widget');

    expect(Object.keys(described!.schemas)).toEqual(['record']);
    expect(described!.schemas.record).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('returns null for a type the host does not have, for the caller to map', () => {
    expect(new SerializationEngine(hostWith([])).describe('widget')).toBeNull();
  });
});

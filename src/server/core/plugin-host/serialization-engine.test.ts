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

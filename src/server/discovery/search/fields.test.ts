/**
 * Search scope, derived from `data.schema` (0.2.9, brief item 26).
 *
 * The file it covers states one hard rule — a path in `searchedFields` must be a
 * path that can actually match — so every case here is a way of breaking that
 * rule in one direction or the other: advertising a path no value lives at, or
 * holding text the agent is then told was searched when it was not.
 *
 * The opaque-value case used to be driven by the real `designSystemData`,
 * because `design-system` is the type the old `z.toJSONSchema` route failed on:
 * its token values are a `record<string,string>`, the branch that was skipped
 * silently for want of declared `properties`. That type moved into the
 * `c4s-plugin-frontend-mockups` envelope in 0.2.18 and the host may not import a
 * plugin's source — doing so pulls `@c4s/plugin-runtime` into the root TS
 * program, where it resolves to the built `dist/` `.d.ts` and makes this file's
 * typecheck depend on build order. So the SHAPE is reproduced below as
 * `opaqueValueData`: a collection of objects whose leaf is a `json` node. The
 * claim is about the shape, not about who declares it.
 */

import { describe, expect, it } from 'vitest';
import { hostDefaultFields, resolveSearchFields, valuesAtPath } from './fields.js';
import { acData } from '../../../shared/entities/ac/schema.js';
import type { BackendModule } from '../../core/plugin-host/types.js';
import type { DataDeclaration } from '../../../shared/plugin-host/data-schema.js';

const moduleWith = (data: DataDeclaration | undefined): BackendModule =>
  ({ type: 'widget', data }) as unknown as BackendModule;

const paths = (data: DataDeclaration | undefined): string[] =>
  hostDefaultFields(moduleWith(data)).map((f) => f.path);

/** `design-system`'s token shape, reproduced: named leaves around an opaque one. */
const opaqueValueData: DataDeclaration = {
  schema: {
    name: { kind: 'string', required: true },
    groups: {
      kind: 'collection',
      collection: 'value',
      item: {
        kind: 'object',
        fields: {
          name: { kind: 'string', required: true },
          tokens: {
            kind: 'collection',
            collection: 'value',
            required: true,
            item: {
              kind: 'object',
              fields: {
                name: { kind: 'string', required: true },
                type: { kind: 'string', required: true },
                value: { kind: 'json', required: true },
              },
            },
          },
        },
      },
    },
  },
};

describe('hostDefaultFields', () => {
  it('reaches into a record through $key and $value — the branch that used to be skipped', () => {
    /**
     * On a FIXTURE, not on `design-system`, since 0.2.9 item 27.
     *
     * Its token value was declared `record<string,string>` and is now `json`:
     * the record declared only the composite arm and rejected `"#2563eb"` once
     * the declaration started validating writes. No shipped type declares a
     * record any more, so the rule needs a schema of its own to be pinned
     * against — otherwise this passes for want of a subject.
     */
    const out = paths({
      schema: {
        labels: { kind: 'record', key: { kind: 'string' }, value: { kind: 'string' } },
        composites: {
          kind: 'record',
          key: { kind: 'string' },
          value: { kind: 'object', fields: { note: { kind: 'string' } } },
        },
      },
    });
    expect(out).toContain('labels.$key');
    expect(out).toContain('labels.$value');
    expect(out).toContain('composites.$value.note');
  });

  it('gives a `json` leaf its OWN path and no children', () => {
    /**
     * The host cannot name a path INSIDE an opaque value, but it can still
     * offer the value itself — `valuesAtPath` keeps only the strings it
     * selects, so a token holding `"#2563eb"` matches and one holding
     * `{fontSize:'16px'}` does not.
     *
     * Emitting nothing at all was the first cut, and it was a silent
     * regression: `design-system` token values were reachable through the
     * `record<string,string>` node `json` replaced, so a query that used to hit
     * would return nothing with `searchedFields` no longer naming the path —
     * the omission invisible as the cause.
     */
    const out = paths(opaqueValueData);
    expect(out).toContain('groups[].tokens[].value');
    expect(out).not.toContain('groups[].tokens[].value.$value');
    // The named leaves around it stay in scope.
    expect(out).toEqual(expect.arrayContaining(['groups[].tokens[].name', 'groups[].tokens[].type']));
  });

  it('covers enum leaves, because a closed set of strings is still text', () => {
    // "deprecated" is a status, and a user searching for it means the field that
    // says so. An enum that is not in scope makes that query silently empty.
    expect(paths(acData)).toEqual(expect.arrayContaining(['kind', 'status']));
  });

  it('excludes systemManaged timestamps', () => {
    // Every type carries two, and a free-text query over an ISO string is noise.
    const out = paths(acData);
    expect(out).not.toContain('createdAt');
    expect(out).not.toContain('updatedAt');
  });

  it('excludes a transient subtree by PREFIX, not just its root', () => {
    const out = paths({
      schema: {
        name: { kind: 'string', required: true },
        upload: {
          kind: 'object',
          transientInput: true,
          fields: { caption: { kind: 'string' } },
        },
      },
    });
    // The child is not in the index either. Excluding only the marked node would
    // advertise `upload.caption`, which no row can ever match.
    expect(out).toEqual(expect.arrayContaining(['name']));
    expect(out).not.toContain('upload');
    expect(out).not.toContain('upload.caption');
  });

  it('guarantees a non-empty scope for a type with no declaration at all', () => {
    // `slug` and `tags[]` are the two paths every entity has whatever it declares
    // — the identity column and the cross-cutting tag layer.
    expect(paths(undefined)).toEqual(['slug', 'tags[]']);
    expect(paths({ schema: { count: { kind: 'number' } } })).toEqual(['slug', 'tags[]']);
  });

  it('boosts an identity path the type actually declares, and invents none', () => {
    const withName = hostDefaultFields(moduleWith({ schema: { name: { kind: 'string' } } }));
    expect(withName).toContainEqual({ path: 'name', weight: 3 });
    // `ac` has no `name`/`label`/`title`; advertising one would be a path that
    // cannot match.
    expect(paths(acData)).not.toContain('title');
  });

  it('degrades to the identity fallback rather than throwing, when the slot throws', () => {
    const broken = {
      type: 'widget',
      get data(): DataDeclaration {
        throw new Error('manifest getter exploded');
      },
    } as unknown as BackendModule;
    expect(hostDefaultFields(broken).map((f) => f.path)).toEqual(['slug', 'tags[]']);
  });
});

describe('resolveSearchFields', () => {
  it('takes the agent’s fields as authored, without repairing them', () => {
    // A path that does not exist must survive into `searchedFields` — silently
    // dropping it is how the field would start lying about what was searched.
    expect(resolveSearchFields(moduleWith(acData), ['nope.not_a_field'])).toEqual([
      { path: 'nope.not_a_field' },
    ]);
  });
});

describe('valuesAtPath', () => {
  const designSystem = {
    slug: 'brand',
    groups: [
      {
        name: 'color',
        tokens: [
          { name: 'primary', value: '#2563eb' },
          { name: 'type-body', value: { fontFamily: 'Inter', fontSize: '16px' } },
        ],
      },
    ],
  };

  it('resolves $value through a record, so a derived path can actually match', () => {
    expect(valuesAtPath(designSystem, 'groups[].tokens[].value.$value')).toEqual(
      expect.arrayContaining(['Inter', '16px']),
    );
  });

  it('resolves $key through a record', () => {
    expect(valuesAtPath(designSystem, 'groups[].tokens[].value.$key')).toEqual(
      expect.arrayContaining(['fontFamily', 'fontSize']),
    );
  });

  it('returns nothing for a $value segment over a scalar, rather than the scalar', () => {
    // `#2563eb` is a string, not a record. Its own path (`…value`) selects it;
    // the record path must not, or one token's literal would answer under both.
    const scalarOnly = { groups: [{ tokens: [{ value: '#2563eb' }] }] };
    expect(valuesAtPath(scalarOnly, 'groups[].tokens[].value.$value')).toEqual([]);
    expect(valuesAtPath(scalarOnly, 'groups[].tokens[].value')).toEqual(['#2563eb']);
  });

  it('still resolves plain and array segments', () => {
    expect(valuesAtPath(designSystem, 'slug')).toEqual(['brand']);
    expect(valuesAtPath(designSystem, 'groups[].name')).toEqual(['color']);
    expect(valuesAtPath(designSystem, 'groups[].nope')).toEqual([]);
  });
});

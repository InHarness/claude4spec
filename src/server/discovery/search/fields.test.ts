/**
 * Search scope, derived from `data.schema` (0.2.9, brief item 26).
 *
 * The file it covers states one hard rule — a path in `searchedFields` must be a
 * path that can actually match — so every case here is a way of breaking that
 * rule in one direction or the other: advertising a path no value lives at, or
 * holding text the agent is then told was searched when it was not.
 *
 * `design-system` is used as the real-declaration case because it is the type
 * the old `z.toJSONSchema` route failed on: its token values are a
 * `record<string,string>`, the branch that was skipped silently for want of
 * declared `properties`.
 */

import { describe, expect, it } from 'vitest';
import { hostDefaultFields, resolveSearchFields, valuesAtPath } from './fields.js';
import { designSystemData } from '../../../shared/entities/design-system/schema.js';
import { acData } from '../../../shared/entities/ac/schema.js';
import type { BackendModule } from '../../core/plugin-host/types.js';
import type { DataDeclaration } from '../../../shared/plugin-host/data-schema.js';

const moduleWith = (data: DataDeclaration | undefined): BackendModule =>
  ({ type: 'widget', data }) as unknown as BackendModule;

const paths = (data: DataDeclaration | undefined): string[] =>
  hostDefaultFields(moduleWith(data)).map((f) => f.path);

describe('hostDefaultFields', () => {
  it('reaches into a record through $key and $value — the branch that used to be skipped', () => {
    const out = paths(designSystemData);
    expect(out).toContain('groups[].tokens[].value.$key');
    expect(out).toContain('groups[].tokens[].value.$value');
    expect(out).toContain('modes[].overrides[].value.$value');
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
    expect(paths(undefined)).toEqual(['slug']);
    expect(paths({ schema: { count: { kind: 'number' } } })).toEqual(['slug']);
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
    expect(hostDefaultFields(broken).map((f) => f.path)).toEqual(['slug']);
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

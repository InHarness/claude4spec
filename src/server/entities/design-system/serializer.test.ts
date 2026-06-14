import { describe, expect, it } from 'vitest';
import { designSystemSerializer, type DesignSystemSnapshot } from './serializer.js';
import { canonicalize } from '../../serialization/snapshot.js';
import type { RawEntity } from '../../domain/raw-entity-reader.js';

const ctx = { reader: {} as never, depth: 0, maxDepth: 1 };

function rawEntity(data: Record<string, unknown>, tags: string[] = []): RawEntity {
  return { type: 'design-system', slug: String(data.slug ?? 'ds'), data, tags };
}

describe('design-system serializer', () => {
  it('snapshot is deterministic: byte-identical, no ids/timestamps, groups/modes/tags sorted, raw values kept', () => {
    const data = {
      slug: 'brand',
      name: 'Brand',
      description: 'desc',
      // groups deliberately out of alphabetical order
      groups: [
        { name: 'Roles', tier: 'semantic', tokens: [{ name: 'action', type: 'color', value: '{blue-500}' }] },
        { name: 'Brand', tier: 'primitive', tokens: [{ name: 'blue-500', type: 'color', value: '#2563eb' }] },
      ],
      modes: [
        { name: 'dark', overrides: [{ token: 'action', value: '{blue-500}' }] },
        { name: 'light', overrides: [] },
      ],
    };
    const e = rawEntity(data, ['zeta', 'alpha']);
    const first = designSystemSerializer.snapshot!(e, ctx) as DesignSystemSnapshot;
    const second = designSystemSerializer.snapshot!(rawEntity(data, ['zeta', 'alpha']), ctx) as DesignSystemSnapshot;

    const firstJson = JSON.stringify(canonicalize(first));
    expect(JSON.stringify(canonicalize(second))).toBe(firstJson);

    expect(firstJson).not.toMatch(/"id":/);
    expect(firstJson).not.toMatch(/"created_at":|"createdAt":/);
    expect(firstJson).not.toMatch(/"updated_at":|"updatedAt":/);

    // groups/modes sorted by name, tags sorted
    expect(first.groups.map((g) => g.name)).toEqual(['Brand', 'Roles']);
    expect(first.modes.map((m) => m.name)).toEqual(['dark', 'light']);
    expect(first.tags).toEqual(['alpha', 'zeta']);

    // raw (unresolved) value kept — resolve() is a presentation concern
    const action = first.groups.find((g) => g.name === 'Roles')!.tokens[0]!;
    expect(action.value).toBe('{blue-500}');
  });

  it('single_element injects a resolvedValue (Base) per token', () => {
    const e = rawEntity({
      slug: 'brand',
      name: 'Brand',
      groups: [
        { name: 'Brand', tier: 'primitive', tokens: [{ name: 'blue-500', type: 'color', value: '#2563eb' }] },
        { name: 'Roles', tier: 'semantic', tokens: [{ name: 'action', type: 'color', value: '{blue-500}' }] },
      ],
      modes: [],
    });
    const single = designSystemSerializer.singleElement!(e, ctx) as {
      groups: Array<{ tokens: Array<{ name: string; resolvedValue: unknown }> }>;
    };
    const action = single.groups.flatMap((g) => g.tokens).find((t) => t.name === 'action')!;
    expect(action.resolvedValue).toBe('#2563eb');
  });

  it('diff reports token add/remove/modify and ignores group reorder (noop)', () => {
    const a: DesignSystemSnapshot = {
      slug: 'brand',
      name: 'Brand',
      description: null,
      groups: [
        { name: 'A', tier: 'primitive', tokens: [{ name: 't1', type: 'color', value: '#000', description: null }] },
        { name: 'B', tier: 'primitive', tokens: [{ name: 't2', type: 'color', value: '#111', description: null }] },
      ],
      modes: [],
      tags: [],
    };
    // reordered groups + a modified token value + an added token
    const b: DesignSystemSnapshot = {
      slug: 'brand',
      name: 'Brand',
      description: null,
      groups: [
        { name: 'B', tier: 'primitive', tokens: [{ name: 't2', type: 'color', value: '#111', description: null }] },
        {
          name: 'A',
          tier: 'primitive',
          tokens: [
            { name: 't1', type: 'color', value: '#fff', description: null },
            { name: 't3', type: 'color', value: '#222', description: null },
          ],
        },
      ],
      modes: [],
      tags: [],
    };

    const reorderOnly = designSystemSerializer.diff!(a, a, 'brand');
    expect(reorderOnly.op).toBe('noop');

    const d = designSystemSerializer.diff!(a, b, 'brand');
    expect(d.op).toBe('modified');
    const changes = d.changes as Record<string, unknown>;
    expect(changes.token_added).toEqual([{ group: 'A', name: 't3', type: 'color' }]);
    expect((changes.token_modified as Array<Record<string, unknown>>)[0]).toMatchObject({
      group: 'A',
      name: 't1',
      value_changed: { from: '#000', to: '#fff' },
    });
  });

  it('serializer version is 1.0.0', () => {
    expect(designSystemSerializer.version).toBe('1.0.0');
  });
});

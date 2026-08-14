import { describe, expect, it } from 'vitest';
import { designSystemSerializer, type DesignSystemSnapshot } from '../src/entity/design-system/serializer.js';
import { designSystemEntity } from '../src/entity/design-system/index.js';
import { canonicalize } from '../../../src/server/serialization/snapshot.js';
import { snapshotFromSchema } from '../../../src/server/serialization/schema-snapshot.js';
import type { RawEntity } from '../src/host-kit/host-types.js';
import { resolve } from '../src/design-system-domain.js';

/**
 * 0.2.9 — the snapshot is GENERATED. What stays design-system-specific, and is
 * what this still checks: `groups`/`modes` are declared `unordered` so they sort
 * by name, while `tokens` and `overrides` are NOT, because a token scale's order
 * is authored content.
 */
const reader = { readCollection: () => [] } as never;
const snapshot = (e: RawEntity) => snapshotFromSchema(designSystemEntity, e, reader);

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
    const first = snapshot(e) as DesignSystemSnapshot;
    const second = snapshot(rawEntity(data, ['zeta', 'alpha'])) as DesignSystemSnapshot;

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

  it('the READ keeps the alias; resolving it is the consumer\'s job', () => {
    /**
     * `single_element` used to inject a `resolvedValue` beside every token's
     * raw `value` — the design-system's one genuinely computed view, and the
     * reason this file is named after views at all.
     *
     * 0.2.23 removes it. Expanding `{blue-500}` is a presentation decision (in
     * which mode? at what moment?), so the record carries what was authored and
     * `resolve()` — unchanged, and still the only implementation — is called by
     * `frontend.renderCard` and by the detail panel's live preview.
     */
    const groups = [
      { name: 'Brand', tier: 'primitive' as const, tokens: [{ name: 'blue-500', type: 'color' as const, value: '#2563eb', description: null }] },
      { name: 'Roles', tier: 'semantic' as const, tokens: [{ name: 'action', type: 'color' as const, value: '{blue-500}', description: null }] },
    ];

    // The read: the alias survives as an alias.
    const record = snapshot(rawEntity({ slug: 'brand', title: 'Brand', groups, modes: [] })) as DesignSystemSnapshot;
    const authored = record.groups.find((g) => g.name === 'Roles')!.tokens[0]!;
    expect(authored.value).toBe('{blue-500}');
    expect(authored).not.toHaveProperty('resolvedValue');

    // The consumer: `resolve()` still expands it, in Base mode.
    expect(resolve(groups, [])['action']).toBe('#2563eb');
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

  it('declares its payload version on the MANIFEST, not on the contribution', () => {
    // 0.2.9: the contribution's copy was an optional echo of a number only the
    // manifest is ever read for, so it is not written twice.
    // 2 since 0.2.9 — v1 files carry a synthesised `description: null` on every
    // token that the generated snapshot does not reproduce. See `./upgrades.ts`.
    expect(designSystemEntity.payloadVersion).toBe(3);
    expect(designSystemSerializer.payloadVersion).toBeUndefined();
  });
});

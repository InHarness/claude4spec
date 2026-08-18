import { describe, expect, it } from 'vitest';
import { designSystemSerialization, type DesignSystemSnapshot } from '../src/entity/design-system/serializer.js';
import { designSystemEntity } from '../src/entity/design-system/index.js';
import { canonicalize } from '../../../src/server/serialization/snapshot.js';
import { diffFromSchema } from '../../../src/server/serialization/schema-diff.js';
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

  /**
   * 0.2.31 — four levels of identity, and every one of them declared.
   *
   * `groups` and `modes` are keyed by `name`, `groups[].tokens` by its LOCAL
   * `name` (group membership is carried by the path, so repeating it in the key
   * would say the same thing twice), and `modes[].overrides` by `token`. The
   * nesting is what makes the recursion worth pinning: a token edit comes back
   * as an `item_modified` on `groups` whose `changes` is itself an
   * `item_modified` on `groups[].tokens` — a LIST, never a count. The old
   * hand-written diff flattened all of this into `token_modified` entries
   * carrying a synthetic `group` field, and reported mode overrides as
   * `override_changes: <number>`.
   */
  it('delta reports token add/modify recursively and ignores group reorder', () => {
    const schema = designSystemEntity.data!.schema;
    const a: DesignSystemSnapshot = {
      slug: 'brand',
      title: 'Brand',
      description: null,
      groups: [
        { name: 'A', tier: 'primitive', tokens: [{ name: 't1', type: 'color', value: '#000', description: null }] },
        { name: 'B', tier: 'primitive', tokens: [{ name: 't2', type: 'color', value: '#111', description: null }] },
      ],
      modes: [],
      tags: [],
    } as unknown as DesignSystemSnapshot;

    // Reordering the groups alone produces NO operations — structurally, because
    // both sides match on `name` and neither pair differs.
    const reordered = { ...a, groups: [...a.groups].reverse() };
    expect(diffFromSchema(schema, a, reordered)).toEqual([]);

    const b = {
      ...a,
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
    } as unknown as DesignSystemSnapshot;

    expect(diffFromSchema(schema, a, b)).toEqual([
      {
        op: 'item_modified',
        path: 'groups',
        identity: { name: 'A' },
        changes: [
          {
            op: 'item_modified',
            path: 'groups[].tokens',
            identity: { name: 't1' },
            changes: [
              {
                // A token's `value` is a free-JSON node, so it is reported by
                // SIZE — the escape hatch has no schema to compare against.
                op: 'field_changed_opaque',
                path: 'groups[].tokens[].value',
                fromBytes: 4,
                toBytes: 4,
              },
            ],
          },
          {
            op: 'item_added',
            path: 'groups[].tokens',
            identity: { name: 't3' },
            item: { name: 't3', type: 'color', value: '#222', description: null },
          },
        ],
      },
    ]);
  });

  /** Mode overrides are a fourth level, keyed by `token` — a list, not a count. */
  it('delta reports a mode override edit as an operation list, never a count', () => {
    const schema = designSystemEntity.data!.schema;
    const base = {
      slug: 'brand',
      title: 'Brand',
      description: null,
      groups: [],
      modes: [{ name: 'dark', overrides: [{ token: 't1', value: '#000' }] }],
      tags: [],
    } as unknown as DesignSystemSnapshot;
    const after = {
      ...base,
      modes: [{ name: 'dark', overrides: [{ token: 't1', value: '#fff' }] }],
    } as unknown as DesignSystemSnapshot;

    expect(diffFromSchema(schema, base, after)).toEqual([
      {
        op: 'item_modified',
        path: 'modes',
        identity: { name: 'dark' },
        changes: [
          {
            op: 'item_modified',
            path: 'modes[].overrides',
            identity: { token: 't1' },
            changes: [
              {
                op: 'field_changed_opaque',
                path: 'modes[].overrides[].value',
                fromBytes: 4,
                toBytes: 4,
              },
            ],
          },
        ],
      },
    ]);
  });

  it('declares its payload version ONCE, on the manifest, with a step per transition', () => {
    // 0.2.24: there is no second place left to write it. The contribution's
    // optional echo went with the `serializer` wrapper, so the number and the
    // chain that has to match its length now sit side by side on the type.
    // 3 — v1 files carry a synthesised `description: null` on every token that
    // the generated snapshot does not reproduce, and v2 files spell the label
    // `name`. See `./upgrades.ts`.
    expect(designSystemEntity.payloadVersion).toBe(3);
    expect(designSystemEntity.payloadUpgrades).toHaveLength(2);
    expect(designSystemSerialization.payloadUpgrades).toHaveLength(2);
  });
});

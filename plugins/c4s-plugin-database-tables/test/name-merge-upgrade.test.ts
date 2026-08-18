/**
 * The name-field merge, from where the corpus ACTUALLY is.
 *
 * Two things this pins, and both were wrong before a review caught them:
 * the step has to be numbered above the version already stamped on disk, and it
 * must not judge the value it moves.
 */

import { describe, expect, it } from 'vitest';
import { databaseTableEntity } from '../src/entity/database-table/index.js';
import { databaseTableSerialization } from '../src/entity/database-table/serializer.js';
import { databaseTableFrontendModule } from '../src/entity/database-table/frontend/module.js';
import { upgradePayload } from '../../../src/server/serialization/payload-upgrade.js';
import type { SnapshotData } from '../src/host-kit/host-types.js';

const module = {
  type: 'database-table',
  payloadVersion: databaseTableEntity.payloadVersion,
  data: databaseTableEntity.data,
  payloadUpgrades: databaseTableSerialization.payloadUpgrades,
} as never;

/** `columns` is required, and the gap check that follows the chain says so. */
const file = (over: Record<string, unknown>) => ({ slug: 's', columns: [], ...over });

const upgrade = (payload: Record<string, unknown>, from: number) =>
  upgradePayload(module, payload as SnapshotData, from).data as Record<string, unknown>;

describe('database-table — the name fields merge', () => {
  it('reaches a file stamped 2, which is where every project opened since 0.2.22 is', () => {
    // The bug this replaces: the merge was numbered 1→2 while the envelope was
    // already 2, so the chain — which fires only BELOW the envelope's version —
    // never ran, and `name` would have stayed in those files forever.
    const out = upgrade(file({ slug: 'order-items', name: 'order_items', title: 'order_items' }), 2);
    expect(out).not.toHaveProperty('name');
    expect(out.title).toBe('order_items');
  });

  it('reaches a v1 file too, by composing both steps', () => {
    const out = upgrade(file({ slug: 'order-items', name: 'order_items' }), 1);
    expect(out).not.toHaveProperty('name');
    expect(out.title).toBe('order_items');
  });

  /**
   * An identifier inherited from the retired plugin, which validated `name` as a
   * bare string — so a corpus really can hold `user profile` or `order`. It
   * indexes, lists and opens; the refusal comes at the INPUT schema, when the
   * author saves, on the surface where they can fix it. Throwing here would make
   * the indexer skip the entity, and it would disappear with only a line in the
   * server log to say so.
   */
  it.each(['user profile', 'order', 'order-list', '2fast'])(
    'carries the illegal identifier %j across rather than refusing it',
    (name) => {
      expect(() => upgrade(file({ name }), 2)).not.toThrow();
      expect(upgrade(file({ name }), 2).title).toBe(name);
    },
  );

  it('never touches a column or index name — those are not entity titles', () => {
    const out = upgrade(
      file({ name: 't', columns: [{ name: 'id' }], indexes: [{ name: 'idx_t_id' }] }),
      2,
    );
    expect(out.columns).toEqual([{ name: 'id' }]);
    expect(out.indexes).toEqual([{ name: 'idx_t_id' }]);
  });

  it('declares one step per version transition, and the frontend agrees on the version', () => {
    expect(databaseTableSerialization.payloadUpgrades).toHaveLength(
      databaseTableEntity.payloadVersion! - 1,
    );
    expect(databaseTableFrontendModule.payloadVersion).toBe(databaseTableEntity.payloadVersion);
  });
});

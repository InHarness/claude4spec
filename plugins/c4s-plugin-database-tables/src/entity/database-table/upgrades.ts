import type { SnapshotData } from '@c4s/plugin-runtime';

/**
 * payload 1 → 2: the table gains a `title`, copied from its SQL `name`.
 *
 * `name` STAYS. This is the only type where the two coexist, because they are
 * two facts: `name` is the identifier code is generated from, `title` is what a
 * person reads. The copy is a starting point, not an equivalence — an author is
 * expected to retitle `order_items` to "Order line items" eventually.
 *
 * The brief expected no step here, on the grounds that the field's
 * `computedDefault` backfills it. That is true for a CREATE, which runs through
 * `applyComputedDefaults`, and it is now also true for a gap found mid-upgrade
 * (`classifyGap` learned to evaluate a derived default in this release). It is
 * NOT true for a file simply being read at the current version: nothing would
 * run. An explicit step makes the corpus migration deterministic rather than a
 * consequence of which path happens to touch the file first.
 *
 * Idempotent: a payload already carrying a `title` keeps it.
 */
export function databaseTablePayloadV1ToV2(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (typeof p.title === 'string' && p.title.trim() !== '') return p;
  p.title = String(p.name ?? '');
  return p;
}

export const databaseTablePayloadUpgrades = [databaseTablePayloadV1ToV2];

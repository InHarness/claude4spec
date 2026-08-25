import type { SnapshotData } from '@c4s/plugin-runtime';

/**
 * `ui-view` payload v1 → v2: `name` becomes the reserved `title`.
 *
 * A move, not a copy. `params[].name` stays exactly as it is — it names a route
 * parameter, and rewriting it would change what the view is addressed by.
 *
 * The slug is unaffected: `slugify(title)` over the same value produces the same
 * string the retired `slugify(name)` did, so no view is renamed and no
 * `designSystemSlug` reference is repointed.
 *
 * Idempotent: a payload already carrying a `title` keeps it.
 */
export function uiViewPayloadV1ToV2(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (typeof p.title !== 'string' || p.title.trim() === '') p.title = String(p.name ?? '');
  delete p.name;
  return p;
}

/**
 * `ui-view` payload v2 → v3: the view gains `mockupHtml`, explicitly absent.
 *
 * Written as `null` rather than left off. The field is `clearable`, so `null`
 * already means "no mockup" everywhere else in the contract, and a payload where
 * the key is present-and-null says the same thing the projection, the snapshot
 * and the read record all say. Leaving the key out would make "not migrated yet"
 * and "no mockup" the same shape, which is exactly the ambiguity a version marker
 * exists to remove.
 *
 * Idempotent, and never overwrites: a payload that somehow already carries a
 * mockup keeps it.
 */
export function uiViewPayloadV2ToV3(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (!('mockupHtml' in p)) p.mockupHtml = null;
  return p;
}

/**
 * `ui-view` payload v3 → v4: the view gains `states[]`, explicitly empty.
 *
 * An EMPTY ARRAY, not `null` and not an omitted key. `states[]` is a value
 * collection with no `clearable` flag, so `null` is not one of its legal values
 * anywhere in the contract — the empty array IS the value that says "this view
 * declares no alternative states", which is the ordinary case rather than the
 * exceptional one. Writing the key makes "not migrated yet" and "no states"
 * distinguishable, the same reason v2→v3 writes `mockupHtml: null` rather than
 * leaving the key off.
 *
 * Idempotent, and never overwrites: a payload that already carries states keeps
 * them.
 */
export function uiViewPayloadV3ToV4(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (!Array.isArray(p.states)) p.states = [];
  return p;
}

export const uiViewPayloadUpgrades = [
  uiViewPayloadV1ToV2,
  uiViewPayloadV2ToV3,
  uiViewPayloadV3ToV4,
];

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

export const uiViewPayloadUpgrades = [uiViewPayloadV1ToV2];

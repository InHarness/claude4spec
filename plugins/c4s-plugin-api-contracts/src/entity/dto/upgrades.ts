import type { SnapshotData } from '@c4s/plugin-runtime';

/**
 * payload 1 → 2: `name` becomes the reserved `title`.
 *
 * A move, not a copy — `name` is deleted. Leaving it would give every DTO two
 * fields holding one value, which is the drift the reserved field exists to end,
 * and the next author to edit one of them would have no way to know which the
 * renderers read.
 *
 * The slug does not change: `slugify(title)` with the same value produces the
 * same string, so nothing is renamed and no reference is repointed.
 *
 * Idempotent: a payload already carrying a `title` is returned untouched.
 */
export function dtoPayloadV1ToV2(payload: SnapshotData): SnapshotData {
  const data = { ...(payload as Record<string, unknown>) };
  if (typeof data.title !== 'string' || data.title.trim() === '') {
    data.title = String(data.name ?? '');
  }
  delete data.name;
  return data as SnapshotData;
}

export const dtoPayloadUpgrades = [dtoPayloadV1ToV2];

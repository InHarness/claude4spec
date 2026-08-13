import type { SnapshotData } from '../../serialization/types.js';

/**
 * payload 1 → 2: every AC gains the reserved `title`.
 *
 * `title := truncate(text, 200)` — the same derivation `acData` declares as the
 * field's `computedDefault`, applied here to entities written before the field
 * existed. Stated twice on purpose: the schema's copy fills the field on a NEW
 * create, this one fills it on an OLD file, and there is no shared runtime
 * between a create payload and a snapshot being upgraded.
 *
 * `text` is left alone. It is the criterion; `title` is a label for it, and an
 * AC whose text runs past 200 characters keeps every one of them.
 *
 * Idempotent: an already-upgraded payload carries a `title` and is returned
 * untouched, which is what makes a re-run after a partial index safe.
 */
export function acPayloadV1ToV2(payload: SnapshotData): SnapshotData {
  const data = payload as Record<string, unknown>;
  if (typeof data.title === 'string' && data.title.trim() !== '') return payload;
  const text = typeof data.text === 'string' ? data.text : '';
  return { ...data, title: text.slice(0, 200) } as SnapshotData;
}

export const acPayloadUpgrades = [acPayloadV1ToV2];

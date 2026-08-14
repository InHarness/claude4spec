import type { SnapshotData } from '../../serialization/types.js';

/**
 * payload 1 → 2: every diagram gains the reserved `title`.
 *
 * `title := the entity's existing slug`, and that is a PLACEHOLDER, not a
 * derivation. It is written down as one so nobody later mistakes it for a rule:
 * a v1 diagram has no field that carries a human label — `source` is a DSL body
 * and `caption` was transient, so it never reached the file — and the slug is
 * the only human-authored string the payload still holds.
 *
 * The consequence is visible and intended: existing diagrams come out of the
 * upgrade titled `checkout-sequence` rather than `Checkout sequence`, and an
 * author who cares will retitle them. The alternative — inventing a title from
 * the diagram body — would produce something that LOOKS authored and is not.
 *
 * `caption` is dropped where it appears. It was declared `transientInput`, so a
 * well-formed v1 file never carried one; a file that does was written by an
 * older path and the value is not part of the entity.
 *
 * Idempotent: a payload that already carries a title is returned untouched.
 */
export function diagramPayloadV1ToV2(payload: SnapshotData): SnapshotData {
  const data = { ...(payload as Record<string, unknown>) };
  delete data.caption;
  delete data.firstSourceIdentifier;
  if (typeof data.title === 'string' && data.title.trim() !== '') return data as SnapshotData;
  data.title = String(data.slug ?? '');
  return data as SnapshotData;
}

export const diagramPayloadUpgrades = [diagramPayloadV1ToV2];

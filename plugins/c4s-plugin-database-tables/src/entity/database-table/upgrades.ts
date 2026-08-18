import type { SnapshotData } from '@c4s/plugin-runtime';

/**
 * payload 1 → 2: `title` starts being written, alongside `name`.
 *
 * HISTORICAL, and left exactly as 0.2.22 shipped it. It is tempting to redefine
 * this step as the merge — the merge is what the release is about, and the
 * chain would be one step shorter. It would also be wrong: a version number is a
 * stamp of SHAPE, and one number cannot mean two shapes. Files stamped `2` by
 * 0.2.22–0.2.26 carry both fields, so `2` means "both fields" for good.
 */
export function databaseTablePayloadV1ToV2(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (typeof p.title !== 'string' || p.title.trim() === '') p.title = String(p.name ?? '');
  return p;
}

/**
 * payload 2 → 3: the name fields merge — `name` goes, the reserved `title` takes
 * over its role.
 *
 * A MOVE, not a copy. The type claimed the two were different facts, an
 * identifier and a label; the corpus refused to confirm it — across 22 entities
 * `title` equalled `name` character for character, never once otherwise. So this
 * is an identity operation on every real file, and what actually changes is that
 * the second field stops existing.
 *
 * WHY 2 → 3 AND NOT A REWRITTEN 1 → 2. `payloadVersion: 2` shipped in 0.2.22, so
 * every project opened since is stamped `2` and the chain fires only BELOW the
 * envelope's version — a redefined 1→2 would never run for them, and the field
 * this release removes would sit in their files forever. The step has to be
 * numbered where the corpus actually is.
 *
 * IT DOES NOT JUDGE THE VALUE. An inherited identifier that is illegal today
 * (`order`, `user profile`) is carried across unchanged, and the entity indexes,
 * lists and opens like any other. Enforcement lives at the INPUT schema — the
 * author meets the refusal when they save, on the surface where they can fix it,
 * which is why a PATCH carries only the fields that changed. Throwing here would
 * be the worst of the available outcomes: the indexer degrades an upgrade error
 * to a `console.warn` and SKIPS the entity, so a table with a legacy name would
 * vanish from the list, from search and from every embed with nothing on screen
 * to say why or where to repair it.
 *
 * `columns[].name` and `indexes[].name` are untouched, now and permanently. They
 * identify a column and an index INSIDE the table; a collection item is not an
 * entity and has no title to take the role.
 *
 * Idempotent: a payload already carrying a `title` keeps it.
 */
export function databaseTablePayloadV2ToV3(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (typeof p.title !== 'string' || p.title.trim() === '') p.title = String(p.name ?? '');
  delete p.name;
  return p;
}

export const databaseTablePayloadUpgrades = [
  databaseTablePayloadV1ToV2,
  databaseTablePayloadV2ToV3,
];

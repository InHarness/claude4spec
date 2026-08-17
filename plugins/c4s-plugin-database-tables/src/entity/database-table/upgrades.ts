import type { SnapshotData } from '@c4s/plugin-runtime';
import { checkValidator, validatorMessage } from '@c4s/plugin-runtime';

/**
 * payload 1 → 2: the name fields merge — `name` goes, the reserved `title` takes
 * over its role.
 *
 * A MOVE, not a copy. The step used to copy `name` into `title` and keep both,
 * because the type claimed the two were different facts — an identifier and a
 * label. The corpus refused to confirm it: across 22 entities `title` equalled
 * `name` character for character, never once otherwise. So the rewrite is an
 * identity operation on every real file, and what actually changes is that the
 * second field stops existing.
 *
 * `columns[].name` and `indexes[].name` are untouched, now and permanently. They
 * identify a column and an index INSIDE the table; a collection item is not an
 * entity and has no title to take the role.
 *
 * REFUSES rather than truncates. `title` now carries `kind: 'sql-identifier'`,
 * and a value that fails it cannot be quietly repaired: shortening an identifier
 * produces a different identifier, and guessing at what the author meant by
 * `user profile` is not a migration's business. A file carrying one stops the
 * upgrade and names itself, which is the outcome that gets it fixed.
 *
 * Idempotent: a payload already carrying a `title` keeps it.
 */
export function databaseTablePayloadV1ToV2(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };

  if (typeof p.title !== 'string' || p.title.trim() === '') p.title = String(p.name ?? '');
  delete p.name;

  const title = String(p.title);
  const failure = checkValidator('sql-identifier', title);
  if (failure) {
    throw new Error(
      `database-table payload 1→2: ${validatorMessage('sql-identifier', failure, title)}. ` +
        `The merged \`title\` is this type's SQL identifier, so it cannot be truncated or ` +
        `coerced into one — rename the table in its entity file and index again`,
    );
  }
  return p;
}

export const databaseTablePayloadUpgrades = [databaseTablePayloadV1ToV2];

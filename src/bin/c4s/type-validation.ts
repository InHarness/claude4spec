import { isRawEntityType, type RawEntityType } from '../../server/discovery/raw-entity-reader.js';
import type { ViewKind } from '../../server/serialization/types.js';
// 0.2.9: the vocabulary comes from the core, which now also guards it
// (`requireView`). The CLI keeps the eager check — it can fail before opening a
// project — but it no longer keeps its own copy of the list to fall out of date.
import { VIEW_KINDS } from '../../server/discovery/views.js';
import { CliError } from './errors.js';

/** Accepts both 'database-table' (canonical) and 'database_table' (spec-alias). */
export function normalizeEntityType(raw: string): RawEntityType {
  const normalized = raw === 'database_table' ? 'database-table' : raw;
  if (!isRawEntityType(normalized)) {
    throw new CliError(
      'INVALID_TYPE',
      `unknown entity type '${raw}'`,
      "allowed: 'endpoint', 'dto', 'database-table', 'ui-view' — run `c4s catalog` for the full list"
    );
  }
  return normalized;
}

/** Validates a view kind, throwing INVALID_VIEW when outside the ViewKind enum. */
export function normalizeViewKind(raw: string): ViewKind {
  if (!VIEW_KINDS.includes(raw as ViewKind)) {
    throw new CliError(
      'INVALID_VIEW',
      `unknown view '${raw}'`,
      `allowed: ${VIEW_KINDS.join(', ')}`
    );
  }
  return raw as ViewKind;
}

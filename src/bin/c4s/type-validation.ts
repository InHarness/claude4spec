import { isRawEntityType, type RawEntityType } from '../../server/domain/raw-entity-reader.js';
import type { ViewKind } from '../../server/serialization/types.js';
import { CliError } from './errors.js';

const VIEW_KINDS: readonly ViewKind[] = [
  'inline_mention',
  'single_element',
  'element_list_item',
  'tagged_list_item',
  'detail',
];

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

import { isRawEntityType, type RawEntityType } from '../../server/domain/raw-entity-reader.js';
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

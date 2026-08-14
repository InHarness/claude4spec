import { type RawEntityType } from '../../server/discovery/raw-entity-reader.js';
import { CliError } from './errors.js';

/** An entity type id is kebab-case: lowercase alphanumerics joined by hyphens. */
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate the SHAPE of a `--type` argument. Existence is not checked here.
 *
 * 0.2.11: this used to hold the vocabulary — a seven-literal membership test
 * plus a `database_table` → `database-table` alias. Both are gone.
 *
 * The membership test could not survive genericisation: which types exist is a
 * property of the project's registry, and this function runs EAGERLY, before a
 * project is open and therefore before any registry exists. Keeping a static
 * list so the CLI could answer early meant rejecting every plugin-contributed
 * type outright — all 13 commands that call this were unusable for them. So the
 * check narrows to what can honestly be decided without a project (is this
 * even shaped like a type id?), and existence is left to the discovery core,
 * which answers it with the navigation this error never had: the known types,
 * and the call that would have worked.
 *
 * The alias is gone for a simpler reason: a type id is always kebab-case, so
 * `database_table` and `ui_view` are not alternative spellings of anything —
 * they are malformed, and now say so.
 */
export function normalizeEntityType(raw: string): RawEntityType {
  if (!KEBAB_RE.test(raw)) {
    throw new CliError(
      'INVALID_TYPE',
      `invalid entity type '${raw}'`,
      'an entity type is kebab-case, e.g. `ui-view` (not `ui_view`) — run `c4s catalog` for the types this project has'
    );
  }
  return raw;
}

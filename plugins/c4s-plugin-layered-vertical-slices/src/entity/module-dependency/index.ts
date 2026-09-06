import type { EntityContribution } from '@c4s/plugin-runtime';
import {
  MODULE_DEPENDENCY_DISPLAY_ORDER,
  MODULE_DEPENDENCY_LABEL,
  MODULE_DEPENDENCY_LABEL_PLURAL,
  MODULE_DEPENDENCY_PATH_PREFIX,
  MODULE_DEPENDENCY_TYPE,
} from './identity.js';
import { moduleDependencyData, moduleDependencySlugPattern } from './schema.js';
import { moduleDependencySystemPrompt } from './system-prompt.js';

/**
 * The `module-dependency` contribution — the type that turns this envelope from
 * a capability into a coupling.
 *
 * NO `backend` KEY AT ALL, and its absence is the declaration. The host
 * generates the whole write path from `data.schema`: the REST router from
 * `pathPrefix` + `data`, the `module_dependency` projection from the same
 * schema, the search scope from its text leaves, and snapshot / restore / diff
 * from the declaration. There is nothing an operation could add — every read
 * this type needs is a generic one:
 *
 *   - outgoing edges of a module → `list_entities` by TAG;
 *   - incoming edges of a module → `list_entities({ filters: { provider } })`,
 *     which works because `provider` is a declared scalar;
 *   - the edge itself → `get_entities`, since no field is `contentBearing`.
 *
 * So: no `mcpServer`, no `mcp-tool` entity, no `srv-*` tag, no `backend.routes`.
 *
 * `slugConflict: 'suffix'`, which is a DECISION and not the default (`'reject'`
 * is). Describing the same ordered pair twice is a duplicate the author should
 * clean up, but it is not a write the host is entitled to refuse — refusing it
 * would lose the second description's `needs` text at the moment of writing,
 * with nothing to show for it. The `-2` suffix files the duplicate visibly and
 * a warning rule reports it.
 *
 * NO `payloadUpgrades`, because `payloadVersion` is 1. Nothing of this type
 * exists on disk anywhere — the type could not be created at all before this
 * release — so there is no earlier shape to migrate from.
 */
export const moduleDependencyEntity: EntityContribution = {
  type: MODULE_DEPENDENCY_TYPE,
  data: moduleDependencyData,
  slugPattern: moduleDependencySlugPattern,
  slugConflict: 'suffix',
  payloadVersion: 1,
  label: MODULE_DEPENDENCY_LABEL,
  labelPlural: MODULE_DEPENDENCY_LABEL_PLURAL,
  displayOrder: MODULE_DEPENDENCY_DISPLAY_ORDER,
  pathPrefix: MODULE_DEPENDENCY_PATH_PREFIX,
  systemPrompt: moduleDependencySystemPrompt,
};

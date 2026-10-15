import { FieldRegistry } from './field-registry.js';
import { PROJECT_SETTINGS_FIELDS, ROOTS_OVERLAP_RULE } from '../workspace/project-settings-fields.js';
import { WRITING_STYLE_SETTINGS_FIELDS } from '../services/writing-style-settings-fields.js';
import { SKILL_EXPOSURE_RULE, SPEC_SKILLS_SETTINGS_FIELDS } from '../services/spec-skills-settings-fields.js';
import { AGENT_SETTINGS_FIELDS } from '../services/agent-settings-fields.js';
import { GIT_COMMIT_TARGET_RULE, GIT_SETTINGS_FIELDS } from '../services/git-settings-fields.js';
import { REMOTE_SETTINGS_FIELDS } from '../services/remote-settings-fields.js';
import { CONSISTENCY_SETTINGS_FIELDS } from '../discovery/ops/consistency-settings-fields.js';
import { entitySettingsFields } from '../core/plugin-host/entity-settings-fields.js';

export interface BuildFieldRegistryInput {
  /** Entity types the host knows, for the `entities` unknown-slug warning. */
  knownEntityTypes?: () => string[];
}

/**
 * 0.2.113 — `config.json` as the SUM of what the modules declare. 2.1.21 (M26
 * `vm9rajvn`): the sum of the layer's field tables ONLY — plugins contribute no
 * fields and have no reserved `plugins.<package>` namespace. Built per request
 * (M26 `alfjoj17`): nothing outlives the call.
 */
export function buildFieldRegistry(input: BuildFieldRegistryInput = {}): FieldRegistry {
  return new FieldRegistry()
    .register(
      ...PROJECT_SETTINGS_FIELDS,
      ...WRITING_STYLE_SETTINGS_FIELDS,
      ...SPEC_SKILLS_SETTINGS_FIELDS,
      ...AGENT_SETTINGS_FIELDS,
      ...GIT_SETTINGS_FIELDS,
      ...REMOTE_SETTINGS_FIELDS,
      ...CONSISTENCY_SETTINGS_FIELDS,
      ...entitySettingsFields(input.knownEntityTypes),
    )
    .registerCrossFieldRule(ROOTS_OVERLAP_RULE)
    .registerCrossFieldRule(GIT_COMMIT_TARGET_RULE)
    .registerCrossFieldRule(SKILL_EXPOSURE_RULE);
}

/** The registry without the known-entity-types probe — what the resume-config snapshot locks. */
export const STATIC_FIELD_REGISTRY = buildFieldRegistry();

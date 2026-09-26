import { FieldRegistry } from './field-registry.js';
import { PROJECT_SETTINGS_FIELDS } from '../workspace/project-settings-fields.js';
import { WRITING_STYLE_SETTINGS_FIELDS } from '../services/writing-style-settings-fields.js';
import { AGENT_SETTINGS_FIELDS } from '../services/agent-settings-fields.js';
import { GIT_COMMIT_TARGET_RULE, GIT_SETTINGS_FIELDS } from '../services/git-settings-fields.js';
import {
  ARTIFACT_DIR_SETTINGS_FIELDS,
  ARTIFACT_DIRS_DIFFER_RULE,
  WRITE_TARGET_OVERLAP_RULE,
} from '../services/artifact-dir-settings-fields.js';
import { REMOTE_SETTINGS_FIELDS } from '../services/remote-settings-fields.js';
import { CONSISTENCY_SETTINGS_FIELDS } from '../discovery/ops/consistency-settings-fields.js';
import { entitySettingsFields, pluginSettingsFields } from '../core/plugin-host/entity-settings-fields.js';
import type { PluginSettingsSection } from '../../shared/plugin-host/manifest.js';

export interface BuildFieldRegistryInput {
  /** `host.listSettings()` — the plugin declarants. Absent ⇒ no plugin fields. */
  pluginSections?: PluginSettingsSection[];
  /** Entity types the host knows, for the `entities` unknown-slug warning. */
  knownEntityTypes?: () => string[];
}

/**
 * 0.2.113 — `config.json` as the SUM of what the modules declare. Built per request:
 * the plugin half follows the active plugin set, which changes without a restart.
 */
export function buildFieldRegistry(input: BuildFieldRegistryInput = {}): FieldRegistry {
  return new FieldRegistry()
    .register(
      ...PROJECT_SETTINGS_FIELDS,
      ...WRITING_STYLE_SETTINGS_FIELDS,
      ...AGENT_SETTINGS_FIELDS,
      ...GIT_SETTINGS_FIELDS,
      ...ARTIFACT_DIR_SETTINGS_FIELDS,
      ...REMOTE_SETTINGS_FIELDS,
      ...CONSISTENCY_SETTINGS_FIELDS,
      ...entitySettingsFields(input.knownEntityTypes),
      ...pluginSettingsFields(input.pluginSections ?? []),
    )
    .registerCrossFieldRule(ARTIFACT_DIRS_DIFFER_RULE)
    .registerCrossFieldRule(WRITE_TARGET_OVERLAP_RULE)
    .registerCrossFieldRule(GIT_COMMIT_TARGET_RULE);
}

/** The static half (no plugins) — what the resume-config snapshot locks. */
export const STATIC_FIELD_REGISTRY = buildFieldRegistry();

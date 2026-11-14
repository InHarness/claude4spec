/**
 * M23 `jbcb06l2` — the `patch` row, contributed by Patches. M23 exists only with
 * the capability `briefs`; the row inherits it. The row names neither
 * `transagent-tools` nor `run-tools`, so a patch thread neither orchestrates,
 * lists artifact sets nor orders Runs.
 */
import { INTERACTION_RULES } from '../../interaction-rules.js';
import { POOL, type ContextTypeRow } from '../row.js';

export const PATCH_ROW: ContextTypeRow = {
  value: 'patch',
  owner: 'M23',
  moduleRequires: ['briefs'],
  requiresCapabilities: [],
  entry: [],
  servers: [POOL, 'plan-tools', 'c4s-tools', 'spec-skill-tools', 'patch-tools'],
  uiChrome: 'overlay',
  posture: { kind: 'follow-thread' },
  builtinGroups: 'none',
  operationClasses: 'all',
  subagent: 'spec-explore',
  backgroundTasks: 'allowed',
  interactionRules: INTERACTION_RULES.patch,
  promptComposition: 'default',
  threadArtifact: 'patch_path',
};

/**
 * M21 `m21ctxreg` — the `brief` row, contributed by Briefs. M21 exists only in a
 * project with the capability `briefs`, so the row inherits that requirement
 * (empty `Wymaga możliwości` cell). `Grupy wbudowane: wszystkie` — the brief's
 * content arrives through the brief read and the style's through the skill read,
 * so built-ins are not needed; denied whatever the project's file-access setting.
 */
import { BRIEF_COMPOSITION } from '../../system-prompt/compositions/brief.js';
import { INTERACTION_RULES } from '../../interaction-rules.js';
import type { ContextTypeRow } from '../row.js';

export const BRIEF_ROW: ContextTypeRow = {
  value: 'brief',
  owner: 'M21',
  moduleRequires: ['briefs'],
  requiresCapabilities: [],
  entry: [],
  servers: ['release-tools', 'brief-tools'],
  uiChrome: 'brief-detail',
  posture: { kind: 'follow-thread' },
  builtinGroups: 'all',
  // ASSUMPTION:dev-context-registry-brief-classes — `wszystkie` as written; admits release-tools writes.
  operationClasses: 'all',
  subagent: 'diff-explore',
  backgroundTasks: 'allowed',
  interactionRules: INTERACTION_RULES.brief,
  promptComposition: { own: BRIEF_COMPOSITION },
  threadArtifact: 'brief_path',
};

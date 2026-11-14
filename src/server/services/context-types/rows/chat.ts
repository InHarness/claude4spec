/**
 * M05 `iatop5pj` — the `chat` row, contributed by the agent runtime. `Wejście:
 * domyślny`: a thread opened without naming a type gets this value (M44 `zvy49ysg`).
 * It has no mandatory artifact, which is why it can be the default.
 */
import { INTERACTION_RULES } from '../../interaction-rules.js';
import { POOL, type ContextTypeRow } from '../row.js';

export const CHAT_ROW: ContextTypeRow = {
  value: 'chat',
  owner: 'M05',
  moduleRequires: [],
  requiresCapabilities: [],
  entry: ['default'],
  servers: [POOL, 'plan-tools', 'c4s-tools', 'spec-skill-tools', 'transagent-tools', 'run-tools'],
  uiChrome: 'overlay',
  posture: { kind: 'follow-thread' },
  builtinGroups: 'none',
  operationClasses: 'all',
  subagent: 'spec-explore',
  backgroundTasks: 'allowed',
  interactionRules: INTERACTION_RULES.chat,
  promptComposition: 'default',
  threadArtifact: 'plan_path',
};
